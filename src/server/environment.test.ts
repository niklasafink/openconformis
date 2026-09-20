// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { configuredSet, configuredValue, reviewDecisionEngine } from "./environment";

describe("configured environment lists", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ignores quotes pasted around the whole value or single entries", () => {
    vi.stubEnv("TEST_CONFIGURED_LIST", "\"openrouter, 'requesty' ,,openai\"");
    expect(configuredSet("TEST_CONFIGURED_LIST")).toEqual(
      new Set(["openrouter", "requesty", "openai"]),
    );
  });

  it("reads single values without pasted quotes", () => {
    vi.stubEnv("TEST_CONFIGURED_VALUE", ' "1" ');
    expect(Number.parseInt(configuredValue("TEST_CONFIGURED_VALUE"), 10)).toBe(1);
    expect(configuredValue("TEST_CONFIGURED_MISSING")).toBe("");
  });
});

describe("review decision engine", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to Jev and accepts the model fallback in any case or with pasted quotes", () => {
    expect(reviewDecisionEngine()).toBe("jev");
    vi.stubEnv("REVIEW_DECISION_ENGINE", ' "Model" ');
    expect(reviewDecisionEngine()).toBe("model");
    vi.stubEnv("REVIEW_DECISION_ENGINE", "jev");
    expect(reviewDecisionEngine()).toBe("jev");
  });

  it("rejects an unknown value instead of silently running through Jev", () => {
    vi.stubEnv("REVIEW_DECISION_ENGINE", "off");
    expect(() => reviewDecisionEngine()).toThrow("REVIEW_DECISION_ENGINE");
  });
});
