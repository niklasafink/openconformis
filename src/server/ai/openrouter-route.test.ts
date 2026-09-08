// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { openRouterBaseUrl, openRouterModelsUrl, openRouterUrl } from "./openrouter-route";
import { getAnalysisProviderConfiguration } from "./provider-routing";

afterEach(() => vi.unstubAllEnvs());

describe("consistent provider routes", () => {
  it("uses the configured global route without imposing an EU filter", () => {
    vi.stubEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("OPENROUTER_EU_BASE_URL", "https://eu.openrouter.ai/api/v1");
    const url = openRouterModelsUrl(
      { baseUrl: openRouterBaseUrl()!, zeroDataRetention: false },
      true,
    );
    expect(url.href).toBe(
      "https://openrouter.ai/api/v1/models/user?supported_parameters=structured_outputs",
    );
  });

  it("enforces the EU and ZDR filters for the corresponding route", () => {
    const url = openRouterModelsUrl(
      { baseUrl: "https://eu.openrouter.ai/api/v1", zeroDataRetention: true },
      true,
    );
    expect(url.searchParams.get("region")).toBe("eu");
    expect(url.searchParams.get("zdr")).toBe("true");
  });

  it.each([
    "not a URL",
    "https://evil.example/api/v1",
    "https://user:pass@openrouter.ai/api/v1",
    "http://openrouter.ai/api/v1",
  ])("rejects unsafe routes: %s", (url) => {
    expect(() => openRouterUrl(url, "models/user")).toThrow();
  });

  it.each(["requesty", "openai"] as const)(
    "keeps %s ZDR independent of OpenRouter settings",
    (provider) => {
      vi.stubEnv("OPENROUTER_ZDR", "false");
      vi.stubEnv(`BYOK_${provider.toUpperCase()}_EU_ZDR_ENABLED`, "true");
      expect(getAnalysisProviderConfiguration(provider).zeroDataRetention).toBe(true);
    },
  );
});
