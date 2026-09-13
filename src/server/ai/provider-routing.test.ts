// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedByokProviders } from "./provider-routing";

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
