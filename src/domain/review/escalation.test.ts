// @vitest-environment node

import { describe, expect, it } from "vitest";

import { cellStateAfterDecision, decideEscalation } from "./escalation";

const base = {
  escalationThresholdBp: 7_000,
  citationNeedsReview: false,
  escalatedSoFar: 0,
  escalationBudgetCells: 100,
};

describe("escalation", () => {
  it("calls the large model below the threshold", () => {
    expect(decideEscalation({ ...base, confidenceBp: 5_500 })).toEqual({
      escalate: true,
      reason: "low_confidence",
      blockedByBudget: false,
    });
  });

  it("does not call it above the threshold", () => {
    expect(decideEscalation({ ...base, confidenceBp: 9_100 })).toEqual({
      escalate: false,
      blockedByBudget: false,
    });
  });

  it("calls it for a failed citation check even when the answer looked certain", () => {
    expect(
      decideEscalation({ ...base, confidenceBp: 9_800, citationNeedsReview: true }),
    ).toMatchObject({ escalate: true, reason: "citation_needs_review" });
  });

  it("stops spending once the budget is used up and marks the cell for review", () => {
    const decision = decideEscalation({
      ...base,
      confidenceBp: 1_000,
      escalatedSoFar: 100,
      escalationBudgetCells: 100,
    });

    expect(decision).toEqual({
      escalate: false,
      reason: "low_confidence",
      blockedByBudget: true,
    });
    expect(cellStateAfterDecision({ escalation: decision, citationNeedsReview: false })).toBe(
      "needs_review",
    );
  });

  it("never quietly completes a cell that wanted a second opinion", () => {
    expect(
      cellStateAfterDecision({
        escalation: { escalate: false, blockedByBudget: false },
        citationNeedsReview: true,
      }),
    ).toBe("needs_review");
  });

  it("completes a confident cell with a verified citation", () => {
    expect(
      cellStateAfterDecision({
        escalation: { escalate: false, blockedByBudget: false },
        citationNeedsReview: false,
      }),
    ).toBe("complete");
  });

  it("treats the exact threshold as good enough", () => {
    expect(decideEscalation({ ...base, confidenceBp: 7_000 }).escalate).toBe(false);
  });
});
