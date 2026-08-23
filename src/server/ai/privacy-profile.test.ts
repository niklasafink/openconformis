import { afterEach, describe, expect, it } from "vitest";

import { sponsoredPrivacyProfileId, sponsoredZeroDataRetention } from "./provider-routing";

const original = process.env.SPONSORED_OPENROUTER_ZDR;
afterEach(() => {
  if (original === undefined) delete process.env.SPONSORED_OPENROUTER_ZDR;
  else process.env.SPONSORED_OPENROUTER_ZDR = original;
});

describe("sponsoredPrivacyProfileId", () => {
  it("claims eu-zdr-v1 only when the route really is EU with retention off", () => {
    expect(
      sponsoredPrivacyProfileId({
        baseUrl: "https://eu.openrouter.ai/api/v1",
        zeroDataRetention: true,
      }),
    ).toBe("eu-zdr-v1");
  });

  it("never claims eu-zdr-v1 for a weaker route", () => {
    // Der Nachweis darf nicht strenger aussehen als der Lauf war.
    expect(
      sponsoredPrivacyProfileId({
        baseUrl: "https://eu.openrouter.ai/api/v1",
        zeroDataRetention: false,
      }),
    ).toBe("openrouter-eu-no-zdr-v1");
    expect(
      sponsoredPrivacyProfileId({
        baseUrl: "https://openrouter.ai/api/v1",
        zeroDataRetention: true,
      }),
    ).toBe("openrouter-global-zdr-v1");
    expect(
      sponsoredPrivacyProfileId({
        baseUrl: "https://openrouter.ai/api/v1",
        zeroDataRetention: false,
      }),
    ).toBe("openrouter-global-no-zdr-v1");
  });

  it("treats an unusable base URL as non-EU rather than assuming the strict case", () => {
    expect(sponsoredPrivacyProfileId({ baseUrl: "", zeroDataRetention: true })).toBe(
      "openrouter-global-zdr-v1",
    );
  });
});

describe("sponsoredZeroDataRetention", () => {
  it("stays on unless it is switched off explicitly", () => {
    delete process.env.SPONSORED_OPENROUTER_ZDR;
    expect(sponsoredZeroDataRetention()).toBe(true);
    process.env.SPONSORED_OPENROUTER_ZDR = "true";
    expect(sponsoredZeroDataRetention()).toBe(true);
    process.env.SPONSORED_OPENROUTER_ZDR = "unsinn";
    expect(sponsoredZeroDataRetention()).toBe(true);
    process.env.SPONSORED_OPENROUTER_ZDR = "false";
    expect(sponsoredZeroDataRetention()).toBe(false);
    process.env.SPONSORED_OPENROUTER_ZDR = "FALSE";
    expect(sponsoredZeroDataRetention()).toBe(false);
  });
});
