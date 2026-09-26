import { describe, expect, it } from "vitest";

import {
  GroundingValidationError,
  noAssessmentPossible,
  validateAndGroundAssessment,
} from "./grounding";

const blocks = [
  {
    id: "b76a7a8f-b95d-4fe8-b476-565127409572",
    blockKey: "policy-2-1",
    canonicalText: "Die Geschäftsleitung genehmigt die Richtlinie einmal jährlich.",
    textHash: "a".repeat(64),
    pageNumber: 2,
    paragraphNumber: 1,
  },
];

describe("assessment grounding", () => {
  it("resolves a verbatim quote to immutable block provenance", () => {
    const result = validateAndGroundAssessment(
      {
        status: "fulfilled",
        explanation: "Die jährliche Genehmigung ist in der Richtlinie ausdrücklich geregelt.",
        confidencePercent: 94,
        evidence: [
          {
            blockKey: "policy-2-1",
            exactQuote: "Die Geschäftsleitung genehmigt die Richtlinie einmal jährlich.",
            support: "supports",
          },
        ],
        missingInformation: [],
      },
      blocks,
    );

    expect(result.evidence[0]).toMatchObject({
      documentBlockId: blocks[0]?.id,
      blockTextHash: "a".repeat(64),
      pageNumber: 2,
    });
  });

  it("rejects a quote invented by the model", () => {
    expect(() =>
      validateAndGroundAssessment(
        {
          status: "fulfilled",
          explanation: "Die Richtlinie enthält angeblich eine nicht vorhandene Regelung.",
          confidencePercent: 90,
          evidence: [
            {
              blockKey: "policy-2-1",
              exactQuote: "Diese erfundene Passage steht nicht im Dokument.",
              support: "supports",
            },
          ],
          missingInformation: [],
        },
        blocks,
      ),
    ).toThrowError(new GroundingValidationError("QUOTE_NOT_FOUND"));
  });

  function groundQuote(canonicalText: string, exactQuote: string) {
    return validateAndGroundAssessment(
      {
        status: "partially_fulfilled",
        explanation: "- Die Aufgaben sind nach drei Verteidigungslinien getrennt.",
        confidencePercent: 70,
        evidence: [{ blockKey: "policy-2-1", exactQuote, support: "supports" }],
        missingInformation: ["Nachweis der Umsetzung"],
      },
      [{ ...blocks[0]!, canonicalText }],
    ).evidence[0]?.exactQuote;
  }

  const linesOfDefence =
    "Die Aufgaben sind nach dem Modell der drei Verteidigungslinien organisiert: Die erste Linie bilden die Fachbereiche, die zweite Linie das CISO-Office.";

  it("stores the document's wording when the model closed a clause with its own period", () => {
    expect(
      groundQuote(
        linesOfDefence,
        "Die Aufgaben sind nach dem Modell der drei Verteidigungslinien organisiert.",
      ),
    ).toBe("Die Aufgaben sind nach dem Modell der drei Verteidigungslinien organisiert");
  });

  it("stores the document's lower-case start when the model capitalised a clause", () => {
    expect(groundQuote(linesOfDefence, "Die zweite Linie das CISO-Office.")).toBe(
      "die zweite Linie das CISO-Office.",
    );
  });

  it("still rejects a quote whose words differ from the document", () => {
    expect(() =>
      groundQuote(linesOfDefence, "Die zweite Linie bildet das CISO-Office."),
    ).toThrowError(new GroundingValidationError("QUOTE_NOT_FOUND"));
  });

  it("requires missing information for a non-assessable result", () => {
    const result = noAssessmentPossible(
      "Die bereitgestellten Inhalte reichen für eine belastbare Bewertung nicht aus.",
      ["Nachweis der Freigabe durch die Geschäftsleitung"],
    );
    expect(result.status).toBe("no_assessment_possible");
    expect(result.confidencePercent).toBe(0);
  });
});
