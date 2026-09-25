import { describe, expect, it } from "vitest";

import {
  assignmentAnswerJsonSchema,
  buildAssignmentPrompt,
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
  it("bildet feste Batches zu zwölf Fundstellen mit stabilem Schlüssel", () => {
    const pending = Array.from({ length: 25 }, (_, index) => mention(index + 1));
    const batches = planAssignmentBatches(pending, frozen);
    expect(batches.map((batch) => batch.items.length)).toEqual([12, 12, 1]);
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
