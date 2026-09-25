import { describe, expect, it } from "vitest";

import type { RequirementAssessment } from "./result-contract";
import { verificationReasons } from "./verification-policy";

function assessment(overrides: Partial<RequirementAssessment> = {}): RequirementAssessment {
  return {
    status: "partially_fulfilled",
    explanation: "Die Anforderung ist nur in Teilen durch belastbare Belegstellen abgedeckt.",
    confidencePercent: 85,
    evidence: [
      {
        blockKey: "block-1",
        exactQuote: "Die Richtlinie wird einmal jährlich überprüft.",
        support: "supports",
      },
    ],
    missingInformation: [],
    ...overrides,
  };
}

describe("verification policy", () => {
  it("verifies every fulfilled result", () => {
    expect(
      verificationReasons("analysis", "requirement", assessment({ status: "fulfilled" })),
    ).toContain("fulfilled");
  });

  it("verifies low-confidence and contradictory results", () => {
    const reasons = verificationReasons(
      "analysis",
      "requirement",
      assessment({
        confidencePercent: 60,
        evidence: [
          {
            blockKey: "block-1",
            exactQuote: "Eine Freigabe durch den Vorstand ist nicht vorgesehen.",
            support: "contradicts",
          },
        ],
      }),
    );
    expect(reasons).toEqual(expect.arrayContaining(["low_confidence", "contradiction"]));
  });

  it("verifies not fulfilled results and results that needed a second attempt", () => {
    expect(
      verificationReasons("analysis", "requirement", assessment({ status: "not_fulfilled" }), {
        retried: true,
      }),
    ).toEqual(expect.arrayContaining(["not_fulfilled", "retried"]));
  });

  it("treats confidence below 85 as low, since fast models state higher confidence", () => {
    expect(
      verificationReasons("analysis", "requirement", assessment({ confidencePercent: 84 })),
    ).toContain("low_confidence");
    expect(
      verificationReasons("analysis", "requirement", assessment({ confidencePercent: 85 })),
    ).not.toContain("low_confidence");
  });

  it("samples about one in ten results for drift", () => {
    const sampled = Array.from({ length: 2_000 }, (_, index) =>
      verificationReasons("analysis", `requirement-${index}`, assessment()),
    ).filter((reasons) => reasons.includes("drift_sample")).length;
    expect(sampled).toBeGreaterThan(150);
    expect(sampled).toBeLessThan(250);
  });

  it("selects the drift sample deterministically", () => {
    const first = verificationReasons("analysis", "requirement", assessment());
    const second = verificationReasons("analysis", "requirement", assessment());
    expect(first).toEqual(second);
  });
});

describe("verification policy is unchanged by the Jev assist", () => {
  it("still verifies a fulfilled result with a single reason — Jev only removes it in the executor", () => {
    expect(
      verificationReasons(
        "analysis",
        "requirement",
        assessment({ status: "fulfilled", confidencePercent: 90 }),
      ).filter((reason) => reason !== "drift_sample"),
    ).toEqual(["fulfilled"]);
  });
});
