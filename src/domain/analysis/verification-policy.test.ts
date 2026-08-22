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

  it("selects the drift sample deterministically", () => {
    const first = verificationReasons("analysis", "requirement", assessment());
    const second = verificationReasons("analysis", "requirement", assessment());
    expect(first).toEqual(second);
  });
});
