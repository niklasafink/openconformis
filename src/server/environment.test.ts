// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { configuredSet } from "./environment";

describe("configured environment lists", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ignores quotes pasted around the whole value or single entries", () => {
    vi.stubEnv("TEST_CONFIGURED_LIST", "\"openrouter, 'requesty' ,,openai\"");
    expect(configuredSet("TEST_CONFIGURED_LIST")).toEqual(
      new Set(["openrouter", "requesty", "openai"]),
    );
  });
});
