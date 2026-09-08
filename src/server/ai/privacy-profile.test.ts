import { afterEach, describe, expect, it } from "vitest";

import { analysisRouteProfileId, openRouterZeroDataRetention } from "./provider-routing";

const original = process.env.OPENROUTER_ZDR;
afterEach(() => {
  if (original === undefined) delete process.env.OPENROUTER_ZDR;
  else process.env.OPENROUTER_ZDR = original;
});

describe("analysisRouteProfileId", () => {
  it("records the actual host and retention state, not a fixed claim", () => {
    expect(
      analysisRouteProfileId({
        provider: "openrouter",
        baseUrl: "https://eu.openrouter.ai/api/v1",
        zeroDataRetention: true,
      }),
    ).toBe("openrouter-eu.openrouter.ai-zdr-v1");
    expect(
      analysisRouteProfileId({
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        zeroDataRetention: false,
      }),
    ).toBe("openrouter-openrouter.ai-no-zdr-v1");
    expect(
      analysisRouteProfileId({
        provider: "requesty",
        baseUrl: "https://router.requesty.ai/v1",
        zeroDataRetention: false,
      }),
    ).toBe("requesty-router.requesty.ai-no-zdr-v1");
  });

  it("treats an unusable base URL as unknown rather than inventing a host", () => {
    expect(
      analysisRouteProfileId({ provider: "openrouter", baseUrl: "", zeroDataRetention: true }),
    ).toBe("openrouter-unknown-zdr-v1");
  });
});

describe("openRouterZeroDataRetention", () => {
  it("stays off unless it is switched on explicitly", () => {
    delete process.env.OPENROUTER_ZDR;
    expect(openRouterZeroDataRetention()).toBe(false);
    process.env.OPENROUTER_ZDR = "false";
    expect(openRouterZeroDataRetention()).toBe(false);
    process.env.OPENROUTER_ZDR = "unsinn";
    expect(openRouterZeroDataRetention()).toBe(false);
    process.env.OPENROUTER_ZDR = "true";
    expect(openRouterZeroDataRetention()).toBe(true);
    process.env.OPENROUTER_ZDR = "TRUE";
    expect(openRouterZeroDataRetention()).toBe(true);
  });
});
