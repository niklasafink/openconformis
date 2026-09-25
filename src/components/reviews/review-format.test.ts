import { describe, expect, it } from "vitest";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import type { ReviewCellSummary } from "@/server/review/read-review";

import {
  answerLabel,
  effectiveAnswer,
  mergeCells,
  percentOf,
  questionColumnInput,
  questionLabel,
  scoreLevelOf,
} from "./review-format";

const cell = (overrides: Partial<ReviewCellSummary>): ReviewCellSummary => ({
  id: "cell-1",
  runDocumentId: "doc",
  runColumnId: "col",
  state: "complete",
  source: "jev",
  answerBoolean: true,
  answerChoice: null,
  answerScoreBp: null,
  probabilityBp: 9_150,
  confidenceBp: 8_300,
  citationVerdict: "verified",
  failureCode: null,
  confirmed: false,
  override: null,
  revision: 1,
  changeSeq: 10,
  ...overrides,
});

describe("answerLabel", () => {
  it("uses the user-facing label of the chosen criterion, never the English description", () => {
    const label = answerLabel(
      {
        type: "choice",
        options: [
          { key: "de", label: "Deutsches Recht", description: "German law governs." },
          { key: "at", label: "Österreichisches Recht", description: "Austrian law governs." },
        ],
      },
      { answerBoolean: null, answerChoice: "at", answerScoreBp: null },
    );
    expect(label).toBe("Österreichisches Recht");
  });

  it("maps a score share back onto the nearest level", () => {
    expect(scoreLevelOf(5_000, 3)).toBe(1);
    expect(scoreLevelOf(10_000, 3)).toBe(2);
    expect(scoreLevelOf(0, 1)).toBe(0);
  });

  it("returns nothing for an answer that does not match the column", () => {
    expect(
      answerLabel(
        {
          type: "noul",
          true: { label: "Ja", description: "y" },
          false: { label: "Nein", description: "n" },
        },
        { answerBoolean: null, answerChoice: "x", answerScoreBp: null },
      ),
    ).toBeUndefined();
  });
});

describe("effectiveAnswer", () => {
  it("prefers a human override over the AI answer", () => {
    const result = effectiveAnswer(
      cell({ override: { answerBoolean: false, answerChoice: null, answerScoreBp: null } }),
    );
    expect(result.overridden).toBe(true);
    expect(result.answer.answerBoolean).toBe(false);
  });
});

describe("mergeCells", () => {
  it("drops a delivery whose revision is older than the known cell", () => {
    const known = new Map([["cell-1", cell({ revision: 3, state: "complete" })]]);
    const next = mergeCells(known, [cell({ revision: 2, state: "deciding" })]);
    expect(next).toBeUndefined();
  });

  it("applies newer revisions and new cells without mutating the current map", () => {
    const known = new Map([["cell-1", cell({ revision: 1, state: "deciding" })]]);
    const next = mergeCells(known, [
      cell({ revision: 2, state: "complete" }),
      cell({ id: "cell-2", revision: 1, state: "queued" }),
    ]);
    expect(next?.get("cell-1")?.state).toBe("complete");
    expect(next?.size).toBe(2);
    expect(known.get("cell-1")?.state).toBe("deciding");
  });
});

describe("questionLabel", () => {
  it("keeps a short question as its own label", () => {
    expect(questionLabel("  Gibt es ein Sonderkündigungsrecht?  ")).toBe(
      "Gibt es ein Sonderkündigungsrecht?",
    );
  });

  it("uses the first line of a question that carries several paragraphs", () => {
    const question = `${"Gilt deutsches Recht? ".repeat(3)}\n\nUnd wenn nein, welches?`;
    expect(questionLabel(question)).toBe(
      "Gilt deutsches Recht? Gilt deutsches Recht? Gilt deutsches Recht?",
    );
  });

  it("never exceeds the 120 characters a column label allows", () => {
    const label = questionLabel("Kündigung ".repeat(40));
    expect(label.length).toBeLessThanOrEqual(120);
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("questionColumnInput", () => {
  it("keeps the whole question as the instruction and labels the answers in the user's language", () => {
    const question = "Enthält der Vertrag eine Haftungsbegrenzung?\n\nAuch der Höhe nach?";
    const column = questionColumnInput(question, { yes: "Ja", no: "Nein" });
    expect(column.instructions).toBe(question);
    expect(column.criteria.type).toBe("noul");
    if (column.criteria.type !== "noul") throw new Error("noul erwartet");
    expect(column.criteria.true.label).toBe("Ja");
    expect(column.criteria.false.label).toBe("Nein");
    // Die Beschreibungen gehen an das Modell und bleiben deshalb englisch.
    expect(column.criteria.true.description).toMatch(/^[\u0000-\u007f]+$/u);
    expect(column.criteria.false.description).toMatch(/^[\u0000-\u007f]+$/u);
  });
});

describe("percentOf", () => {
  it("formats basis points as a percentage without a trailing zero", () => {
    expect(percentOf(9_150, "de")).toBe("91,5");
    expect(percentOf(9_150, "en")).toBe("91.5");
    expect(percentOf(10_000, "de")).toBe("100");
    expect(percentOf(null, "de")).toBeUndefined();
  });
});

/**
 * Jeder Code, den Start, Verwaltung, Aktionen und Export der Vertragsprüfung
 * ausgeben können, braucht einen Satz in beiden Sprachen — ein Nutzer sieht nie
 * einen rohen Code.
 */
const codesTheReviewCanReturn = [
  "REVIEW_TYPESAFE_KEY_REQUIRED",
  "REVIEW_MODEL_KEY_REQUIRED",
  "REVIEW_TABLE_NOT_FOUND",
  "REVIEW_NO_DOCUMENTS",
  "REVIEW_NO_COLUMNS",
  "REVIEW_TOO_LARGE",
  "REVIEW_DOCUMENT_NOT_READY",
  "REVIEW_DOCUMENT_NOT_FOUND",
  "REVIEW_DOCUMENT_IN_USE",
  "REVIEW_ENGINE_INVALID",
  "REVIEW_INPUT_INVALID",
  "REVIEW_RUN_ACTIVE",
  "REVIEW_COLUMN_NOT_FOUND",
  "REVIEW_COLUMN_TYPE_LOCKED",
  "REVIEW_COLUMN_OPTION_KEYS_DUPLICATE",
  "MODEL_SELECTION_NOT_FOUND",
  "BYOK_ROUTE_NOT_EXECUTABLE",
  "REVIEW_RUN_NOT_FOUND",
  "REVIEW_CELL_NOT_FOUND",
  "REVIEW_NOT_FINISHED",
  "REVIEW_EXPORT_TOO_LARGE",
  "REVIEW_FORBIDDEN",
  "MEMBERSHIP_REQUIRED",
  "REVIEW_CELL_NOT_CONFIRMABLE",
  "REVIEW_CELL_NOT_SETTLED",
  "REVIEW_OVERRIDE_ANSWER_INVALID",
];
const failureCodesACellOrRunCanCarry = [
  "JEV_ANSWER_INVALID",
  "MODEL_OUTPUT_INVALID",
  "CELL_NOT_SETTLED",
  "CHILD_RUN_FAILED",
  "CHILD_RUN_CANCELLED",
  "REVIEW_CANCELLED",
  "REVIEW_DEADLINE_EXCEEDED",
  "REVIEW_TOO_MANY_GAPS",
];

describe("review messages", () => {
  it.each([
    ["de", de.Review],
    ["en", en.Review],
  ])("explain every review code in %s", (_locale, review) => {
    for (const code of codesTheReviewCanReturn) {
      expect(review.errors[code as keyof typeof review.errors], `kein Text für ${code}`).toMatch(
        /\S{20,}|\s/u,
      );
    }
    for (const code of failureCodesACellOrRunCanCarry) {
      expect(
        review.failures[code as keyof typeof review.failures],
        `kein Text für ${code}`,
      ).toMatch(/\s/u);
    }
  });

  it("keeps the German and English key sets identical", () => {
    const keysOf = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, entry]) => keysOf(entry, `${prefix}${key}.`))
        : [prefix];
    expect(keysOf(en.Review)).toEqual(keysOf(de.Review));
    expect(keysOf(en.Navigation)).toEqual(keysOf(de.Navigation));
  });
});
