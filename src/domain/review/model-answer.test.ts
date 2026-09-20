// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildReviewDecisionPrompt,
  citationReferencesIn,
  rationaleMatchesCitations,
  reviewModelAnswerSchema,
} from "./model-answer";
import type { ReviewColumnSnapshot } from "./column";

const column: ReviewColumnSnapshot = {
  label: "Anwendbares Recht",
  columnType: "choice",
  instructions: "Which law governs the contract?",
  criteria: {
    type: "choice",
    options: [
      { key: "de", label: "Deutsch", description: "German law governs." },
      { key: "at", label: "Österreichisch", description: "Austrian law governs." },
    ],
  },
};

describe("large-model prompt", () => {
  it("treats passages as untrusted evidence and demands verbatim quotes", () => {
    const prompt = buildReviewDecisionPrompt({
      locale: "de",
      column,
      blocks: [{ blockKey: "p1", canonicalText: "Es gilt deutsches Recht." }],
    });
    expect(prompt.system).toContain("untrusted evidence");
    expect(prompt.system).toContain("copied verbatim");
    // Keine Verbesserungsvorschläge, in keiner Bewertung.
    expect(prompt.system).toContain("Do not propose improvements");
    expect(prompt.system).toContain("in German");
    expect(prompt.user).toContain("de: German law governs.");
    expect(prompt.user).toContain("[p1] Es gilt deutsches Recht.");
  });

  it("says plainly when there is no passage", () => {
    const prompt = buildReviewDecisionPrompt({ locale: "en", column, blocks: [] });
    expect(prompt.user).toContain("no passage of the contract was found");
  });

  it("validates the answer shape", () => {
    expect(
      reviewModelAnswerSchema.safeParse({
        answerBoolean: null,
        answerChoice: "de",
        answerScoreLevel: null,
        confidencePercent: 90,
        rationale: "Deutsches Recht [1].",
        citations: [],
      }).success,
    ).toBe(true);
    expect(reviewModelAnswerSchema.safeParse({ answerChoice: "de" }).success).toBe(false);
  });
});

describe("citation numbers in a rationale", () => {
  it("finds the referenced numbers and rejects one without a citation", () => {
    expect(citationReferencesIn("Siehe [1] und [3].")).toEqual([1, 3]);
    expect(rationaleMatchesCitations("Siehe [1] und [2].", 2)).toBe(true);
    expect(rationaleMatchesCitations("Siehe [3].", 2)).toBe(false);
    expect(rationaleMatchesCitations("Siehe [0].", 2)).toBe(false);
    expect(rationaleMatchesCitations("Keine Nummern.", 0)).toBe(true);
  });
});
