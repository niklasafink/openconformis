import { describe, expect, it } from "vitest";

import { nextProcessingPollDelay } from "./processing-poll";

describe("nextProcessingPollDelay", () => {
  it("asks again quickly first, so a fast parse is not held back", () => {
    expect(nextProcessingPollDelay(0)).toBeLessThan(1_000);
  });

  it("never waits less than before and settles at two seconds", () => {
    const delays = Array.from({ length: 12 }, (_, attempt) => nextProcessingPollDelay(attempt));
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1] ?? 0);
    }
    expect(delays.at(-1)).toBe(2_000);
  });

  it("treats a nonsensical attempt count as the first one", () => {
    expect(nextProcessingPollDelay(-3)).toBe(nextProcessingPollDelay(0));
    expect(nextProcessingPollDelay(Number.NaN)).toBe(nextProcessingPollDelay(0));
  });
});
