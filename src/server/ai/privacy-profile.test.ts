import { afterEach, describe, expect, it } from "vitest";

import { openRouterPrivacyProfileId, openRouterZeroDataRetention } from "./provider-routing";

const original = process.env.OPENROUTER_ZDR;
afterEach(() => {
  if (original === undefined) delete process.env.OPENROUTER_ZDR;
  else process.env.OPENROUTER_ZDR = original;
});

describe("openRouterPrivacyProfileId", () => {
  it("claims eu-zdr-v1 only when the route really is EU with retention off", () => {
    expect(
      openRouterPrivacyProfileId({
        baseUrl: "https://eu.openrouter.ai/api/v1",
        zeroDataRetention: true,
      }),
    ).toBe("eu-zdr-v1");
  });

  it("never claims eu-zdr-v1 for a weaker route", () => {
    // Der Nachweis darf nicht strenger aussehen als der Lauf war.
    expect(
      openRouterPrivacyProfileId({
        baseUrl: "https://eu.openrouter.ai/api/v1",
        zeroDataRetention: false,
      }),
    ).toBe("openrouter-eu-no-zdr-v1");
    expect(
      openRouterPrivacyProfileId({
        baseUrl: "https://openrouter.ai/api/v1",
        zeroDataRetention: true,
      }),
    ).toBe("openrouter-global-zdr-v1");
    expect(
      openRouterPrivacyProfileId({
        baseUrl: "https://openrouter.ai/api/v1",
        zeroDataRetention: false,
      }),
    ).toBe("openrouter-global-no-zdr-v1");
  });

  it("treats an unusable base URL as non-EU rather than assuming the strict case", () => {
    expect(openRouterPrivacyProfileId({ baseUrl: "", zeroDataRetention: true })).toBe(
      "openrouter-global-zdr-v1",
    );
  });
});

describe("openRouterZeroDataRetention", () => {
  it("stays on unless it is switched off explicitly", () => {
    delete process.env.OPENROUTER_ZDR;
    expect(openRouterZeroDataRetention()).toBe(true);
    process.env.OPENROUTER_ZDR = "true";
    expect(openRouterZeroDataRetention()).toBe(true);
    process.env.OPENROUTER_ZDR = "unsinn";
    expect(openRouterZeroDataRetention()).toBe(true);
    process.env.OPENROUTER_ZDR = "false";
    expect(openRouterZeroDataRetention()).toBe(false);
    process.env.OPENROUTER_ZDR = "FALSE";
    expect(openRouterZeroDataRetention()).toBe(false);
  });
});
