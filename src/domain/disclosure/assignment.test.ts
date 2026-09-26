import { describe, expect, it } from "vitest";

import {
  assignmentAnswerJsonSchema,
  assignmentChunk,
  assignmentChunkCount,
  assignmentChunkSize,
  buildAssignmentPrompt,
  checkedFigureFrontier,
  planAssignmentBatches,
  readAssignments,
} from "./assignment";
import type { PendingMention } from "./checks/text";

const mention = (index: number): PendingMention => ({
  figureId: `figure-${index}`,
  blockId: "block",
  sentence: `Die Forderungen gegen Beteiligungsunternehmen von TEUR ${index} betreffen die apoBank.`,
  start: 55,
  end: 55 + String(index).length,
  candidates: [
    {
      key: "label:forderungen gegen beteiligungsunternehmen",
      label: "Forderungen gegen Beteiligungsunternehmen",
    },
    { key: "forderungen_ll", label: "Forderungen aus Lieferungen und Leistungen" },
  ],
});

const frozen = { providerModelId: "test/model", promptVersion: "disclosure-assignment-v1" };

describe("assignment batches", () => {
  it("bildet feste Batches zu sechs Fundstellen mit stabilem Schlüssel", () => {
    const pending = Array.from({ length: 13 }, (_, index) => mention(index + 1));
    const batches = planAssignmentBatches(pending, frozen);
    expect(batches.map((batch) => batch.items.length)).toEqual([6, 6, 1]);
    expect(batches[0]!.key).toMatch(/^[0-9a-f]{64}$/u);
    expect(planAssignmentBatches(pending, frozen)[1]!.key).toBe(batches[1]!.key);
    expect(
      planAssignmentBatches(pending, { ...frozen, providerModelId: "other" })[0]!.key,
    ).not.toBe(batches[0]!.key);
  });

  it("gibt dem Modell nur Kurzzeichen, die Antwort enthält nie Beträge", () => {
    const [batch] = planAssignmentBatches([mention(54)], frozen);
    const prompt = buildAssignmentPrompt(batch!);
    expect(prompt.user).toContain(
      "F1: Die Forderungen gegen Beteiligungsunternehmen von TEUR ⟦54⟧",
    );
    expect(prompt.user).toContain("1 = Forderungen gegen Beteiligungsunternehmen");
    const fields = Object.keys(assignmentAnswerJsonSchema.properties.assignments.items.properties);
    expect(fields).toEqual(["ref", "candidate", "period", "confidencePercent", "comment"]);
  });

  it("verwirft unbekannte Fundstellen, fremde Kandidaten und doppelte Antworten", () => {
    const [batch] = planAssignmentBatches([mention(54), mention(19)], frozen);
    const assignments = readAssignments(batch!, {
      assignments: [
        {
          ref: "F1",
          candidate: "1",
          period: "current",
          confidencePercent: 91,
          comment: "Bestand.",
        },
        { ref: "F1", candidate: "2", period: "current", confidencePercent: 99, comment: "" },
        { ref: "F2", candidate: "7", period: "current", confidencePercent: 80, comment: "" },
        { ref: "F9", candidate: "1", period: "prior", confidencePercent: 80, comment: "" },
      ],
    });
    expect(assignments).toEqual([
      {
        figureId: "figure-54",
        key: "label:forderungen gegen beteiligungsunternehmen",
        label: "Forderungen gegen Beteiligungsunternehmen",
        period: "current",
        confidenceBp: 9_100,
        comment: "Bestand.",
      },
    ]);
  });
});

describe("Abschnitte von oben nach unten", () => {
  const blocks = [
    { id: "b1", ordinal: 1 },
    { id: "b2", ordinal: 2 },
  ];
  // Die Datenbank liefert Zahlen nach Block-ID, nicht nach Lage im Dokument.
  const figures = [
    { id: "late", blockId: "b2", start: 0 },
    { id: "early", blockId: "b1", start: 10 },
    { id: "first", blockId: "b1", start: 0 },
  ];
  const document = { blocks, figures } as unknown as Parameters<typeof checkedFigureFrontier>[0];

  it("teilt die offenen Fundstellen in Abschnitte paralleler Batches", () => {
    const pending = Array.from({ length: assignmentChunkSize + 1 }, (_, index) => index);
    expect(assignmentChunkCount(pending.length)).toBe(2);
    expect(assignmentChunk(pending, 1)).toEqual([assignmentChunkSize]);
    expect(assignmentChunkCount(0)).toBe(0);
  });

  it("zählt als geprüft alle Zahlen vor der ersten offenen Fundstelle in Dokumentreihenfolge", () => {
    expect(checkedFigureFrontier(document, [{ figureId: "early" }], 0)).toBe(1);
    expect(checkedFigureFrontier(document, [{ figureId: "late" }], 0)).toBe(2);
    expect(checkedFigureFrontier(document, [{ figureId: "early" }], 1)).toBe(3);
  });
});
