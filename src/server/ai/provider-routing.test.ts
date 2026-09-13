// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedByokProviders, getAnalysisProviderConfiguration } from "./provider-routing";

describe("BYOK provider allowlist", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps OpenRouter usable when the allowlist is empty", () => {
    vi.stubEnv("BYOK_PROVIDER_ALLOWLIST", "");
    expect([...allowedByokProviders()]).toEqual(["openrouter"]);
  });

  it("honours a configured allowlist, including pasted quotes", () => {
    vi.stubEnv("BYOK_PROVIDER_ALLOWLIST", '"requesty,openai"');
    const allowed = allowedByokProviders();
    expect(allowed.has("requesty")).toBe(true);
    expect(allowed.has("openrouter")).toBe(false);
  });
});

describe("analysis output budget", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("leaves room for reasoning tokens and keeps reasoning brief by default", () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("BYOK_MAX_OUTPUT_TOKENS", "");
    vi.stubEnv("BYOK_REASONING_EFFORT", "");
    const configuration = getAnalysisProviderConfiguration("openrouter");
    expect(configuration.maxOutputTokens).toBe(8000);
    expect(configuration.reasoningEffort).toBe("low");
  });

  it("rejects a reasoning effort the providers do not understand", () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("BYOK_REASONING_EFFORT", "turbo");
    expect(() => getAnalysisProviderConfiguration("openrouter")).toThrow(
      "REASONING_EFFORT_INVALID",
    );
  });
});
