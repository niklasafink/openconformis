// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analysisJevAssistMode,
  configuredSet,
  configuredValue,
  reviewDecisionEngine,
} from "./environment";

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

describe("gap analysis Jev assist mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off by default and for an empty value", () => {
    expect(analysisJevAssistMode()).toBe("off");
    vi.stubEnv("ANALYSIS_JEV_ASSIST", "  ");
    expect(analysisJevAssistMode()).toBe("off");
  });

  it.each(["retrieval", "verification", "all"])("accepts %s in any case", (mode) => {
    vi.stubEnv("ANALYSIS_JEV_ASSIST", ` "${mode.toUpperCase()}" `);
    expect(analysisJevAssistMode()).toBe(mode);
  });

  it("falls back to off for an unknown value instead of blocking or enabling Jev", () => {
    vi.stubEnv("ANALYSIS_JEV_ASSIST", "on");
    expect(analysisJevAssistMode()).toBe("off");
    vi.stubEnv("ANALYSIS_JEV_ASSIST", "jev");
    expect(analysisJevAssistMode()).toBe("off");
  });
});
