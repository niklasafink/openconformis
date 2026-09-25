import { describe, expect, it } from "vitest";

import { systemOneModelId, systemOneRequestSchema } from "@/domain/ai/system-one";

import { assignmentAnswerSchema, planAssignmentBatches, readAssignments } from "./assignment";
import {
  disclosureJevPromptVersion,
  jevAnswerFor,
  jevRequestFor,
  jevResolvedFigureIds,
} from "./jev-assignment";

const pending = [
  {
    figureId: "f-1",
    blockId: "b-1",
    sentence: "Die Forderungen gegen Beteiligungsunternehmen von TEUR 54 betreffen die apoBank.",
    start: 55,
    end: 57,
    candidates: [
      {
        key: "label:forderungen gegen beteiligungsunternehmen",
        label: "Forderungen gegen Beteiligungsunternehmen",
      },
      { key: "bilanzsumme", label: "Bilanzsumme" },
    ],
  },
  {
    figureId: "f-2",
    blockId: "b-2",
    sentence: "Der Personalaufwand beträgt TEUR 6.364.",
    start: 33,
    end: 38,
    candidates: [{ key: "personalaufwand", label: "Personalaufwand" }],
  },
];

const [batch] = planAssignmentBatches(pending, {
  providerModelId: systemOneModelId,
  promptVersion: disclosureJevPromptVersion,
});

function choice(option: string, confidence: number) {
  return {
    type: "choice" as const,
    choice: option,
    confidence,
    probabilities: { [option]: confidence },
  };
}

describe("Einordnung durch Jev", () => {
  it("stellt je Fundstelle eine gültige Anfrage mit markierter Zahl und Kandidaten-IDs", () => {
    const request = jevRequestFor(batch!.items[0]!);
    expect(request.state).toContain("⟦54⟧");
    expect(systemOneRequestSchema.safeParse({ model: systemOneModelId, ...request }).success).toBe(
      true,
    );
    const lineItem = request.questions.line_item;
    expect(lineItem.type === "choice" && Object.keys(lineItem.criteria)).toEqual([
      "c1",
      "c2",
      "none",
    ]);
    // Die Fragen nennen nie einen Betrag; die Zahl steht nur im Zustand.
    expect(JSON.stringify(request.questions)).not.toMatch(/\d{2}/u);
  });

  it("liefert dasselbe Antwortschema wie das Nutzermodell, nur mit Kurzzeichen", () => {
    const answer = jevAnswerFor(
      batch!,
      new Map([
        ["F1", { line_item: choice("c1", 0.93), period: choice("current", 0.88) }],
        ["F2", { line_item: choice("none", 0.95), period: choice("other", 0.9) }],
      ]),
    );
    expect(assignmentAnswerSchema.parse(answer)).toEqual({
      assignments: [
        { ref: "F1", candidate: "1", period: "current", confidencePercent: 88, comment: "" },
        { ref: "F2", candidate: "none", period: "other", confidencePercent: 90, comment: "" },
      ],
    });
    expect(readAssignments(batch!, answer)).toEqual([
      expect.objectContaining({ figureId: "f-1", key: pending[0]!.candidates[0]!.key }),
      expect.objectContaining({ figureId: "f-2", key: null }),
    ]);
  });

  it("verwirft unbekannte Optionen und falsche Fragetypen, statt zu raten", () => {
    const answer = jevAnswerFor(
      batch!,
      new Map([
        ["F1", { line_item: choice("c9", 0.99), period: choice("current", 0.99) }],
        ["F2", { line_item: { type: "noul" as const, noul: 0.9 }, period: choice("prior", 0.99) }],
      ]),
    );
    expect(answer.assignments).toEqual([]);
  });

  it("gibt nur sichere Zuordnungen frei; der Rest geht an das Nutzermodell", () => {
    const answer = jevAnswerFor(
      batch!,
      new Map([
        ["F1", { line_item: choice("c1", 0.95), period: choice("current", 0.95) }],
        ["F2", { line_item: choice("c1", 0.6), period: choice("current", 0.95) }],
      ]),
    );
    expect([...jevResolvedFigureIds(batch!, answer)]).toEqual(["f-1"]);
  });
});
