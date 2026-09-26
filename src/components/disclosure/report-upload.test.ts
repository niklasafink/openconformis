import { describe, expect, it } from "vitest";

import { processingPercent, uploadPercent } from "./report-upload";

describe("report upload progress", () => {
  it("maps uploaded bytes onto the upload share of the bar", () => {
    expect(uploadPercent(0)).toBe(5);
    expect(uploadPercent(50)).toBe(32.5);
    expect(uploadPercent(100)).toBe(60);
  });

  it("jumps to the reported processing stage and never moves backwards", () => {
    expect(processingPercent(65, "parsing")).toBeGreaterThan(80);
    expect(processingPercent(90, "uploaded")).toBeGreaterThan(90);
  });

  it("keeps creeping during a long stage without reaching completion", () => {
    let percent = 65;
    for (let poll = 0; poll < 150; poll += 1) percent = processingPercent(percent, "parsing");
    expect(percent).toBeLessThanOrEqual(95);
    expect(percent).toBeGreaterThan(94);
  });
});
