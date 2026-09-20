// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  citationQuestion,
  composeRationale,
  decisionFromAnswer,
  decisionFromModelAnswer,
  decisionQuestion,
  injectionQuestion,
  normalizeColumnCriteria,
  relevanceQuestion,
  reviewColumnContentHash,
  reviewColumnInputSchema,
  type ReviewColumnSnapshot,
} from "./column";

const terminationColumn: ReviewColumnSnapshot = {
  label: "Kündigung aus wichtigem Grund",
  columnType: "noul",
  instructions: "Does the contract grant a right of termination for cause?",
  criteria: {
    type: "noul",
    true: { label: "Ja, ausdrücklich geregelt", description: "The contract grants the right." },
    false: { label: "Nein oder nicht geregelt", description: "The contract is silent." },
  },
};

const lawColumn: ReviewColumnSnapshot = {
  label: "Anwendbares Recht",
  columnType: "choice",
  instructions: "Which law governs the contract?",
  criteria: {
    type: "choice",
    options: [
      { key: "de", label: "Deutsches Recht", description: "German law governs." },
      { key: "at", label: "Österreichisches Recht", description: "Austrian law governs." },
      { key: "other", label: "Anderes Recht", description: "Another law governs." },
    ],
  },
};

const liabilityColumn: ReviewColumnSnapshot = {
  label: "Haftungsbegrenzung",
  columnType: "score",
  instructions: "How strictly is liability limited?",
  criteria: {
    type: "score",
    levels: [
      { label: "Nicht begrenzt", description: "No limitation." },
      { label: "Teilweise begrenzt", description: "Partly limited." },
      { label: "Streng begrenzt", description: "Strictly limited." },
    ],
  },
};

describe("review column questions", () => {
  it("sends the English descriptions to the provider, never the German labels", () => {
    expect(decisionQuestion(terminationColumn)).toEqual({
      type: "noul",
      instructions: "Does the contract grant a right of termination for cause?",
      criteria: { true: "The contract grants the right.", false: "The contract is silent." },
    });
    expect(decisionQuestion(lawColumn).criteria).toEqual({
      de: "German law governs.",
      at: "Austrian law governs.",
      other: "Another law governs.",
    });
    expect(decisionQuestion(liabilityColumn).criteria).toEqual([
      "No limitation.",
      "Partly limited.",
      "Strictly limited.",
    ]);
  });

  it("asks a separate injection question so a contract cannot instruct the reader", () => {
    expect(injectionQuestion().type).toBe("noul");
    expect(relevanceQuestion(terminationColumn).instructions).toContain(
      terminationColumn.instructions,
    );
  });

  it("asks whether the quote supports, contradicts or is silent on the claim", () => {
    const question = citationQuestion("The contract allows termination for cause.");
    expect(question.type).toBe("choice");
    expect(Object.keys(question.type === "choice" ? question.criteria : {})).toEqual([
      "supports",
      "contradicts",
      "silent",
    ]);
  });
});

describe("typed decision from a System One answer", () => {
  it("reads a yes with its probability and the matching criterion", () => {
    const decision = decisionFromAnswer(terminationColumn, { type: "noul", noul: 0.92 });

    expect(decision).toMatchObject({
      answerBoolean: true,
      probabilityBp: 9200,
      confidenceBp: 8400,
      criterion: { label: "Ja, ausdrücklich geregelt" },
    });
  });

  it("treats a clear no as confident, not as uncertain", () => {
    // 0,5 ist bei `noul` die unsicherste Antwort; 0,02 ist ein klares Nein.
    const decision = decisionFromAnswer(terminationColumn, { type: "noul", noul: 0.02 });

    expect(decision).toMatchObject({ answerBoolean: false, probabilityBp: 9800 });
    expect(decision!.confidenceBp).toBe(9600);
  });

  it("refuses an option the column does not offer instead of inventing one", () => {
    expect(
      decisionFromAnswer(lawColumn, {
        type: "choice",
        choice: "fr",
        confidence: 0.9,
        probabilities: { fr: 0.9 },
      }),
    ).toBeUndefined();
  });

  it("refuses an answer whose type does not match the column", () => {
    expect(decisionFromAnswer(lawColumn, { type: "noul", noul: 0.9 })).toBeUndefined();
  });

  it("maps a score onto the scale and picks the nearest level", () => {
    const decision = decisionFromAnswer(liabilityColumn, {
      type: "score",
      score: 2,
      confidence: 0.8,
      probabilities: { "0": 0.05, "1": 0.15, "2": 0.8 },
    });

    expect(decision).toMatchObject({
      answerScoreBp: 10_000,
      probabilityBp: 8000,
      criterion: { label: "Streng begrenzt" },
    });
  });

  it("refuses a score outside the scale", () => {
    expect(
      decisionFromAnswer(liabilityColumn, {
        type: "score",
        score: 5,
        confidence: 0.9,
        probabilities: {},
      }),
    ).toBeUndefined();
  });
});

describe("assembled rationale", () => {
  it("contains only the column label, the chosen criterion, the probability and the evidence numbers", () => {
    const decision = decisionFromAnswer(terminationColumn, { type: "noul", noul: 0.92 })!;
    const rationale = composeRationale({
      locale: "de",
      columnLabel: terminationColumn.label,
      decision,
      citationNumbers: [2, 1],
    });

    expect(rationale).toBe(
      "Kündigung aus wichtigem Grund: Ja, ausdrücklich geregelt Wahrscheinlichkeit 92 %. Belege [1], [2].",
    );
    // Kein englischer Modelltext und keine Anbieter-Beschreibung im Ergebnis.
    expect(rationale).not.toContain("The contract");
  });

  it("states plainly when there is no evidence rather than leaving a silent gap", () => {
    const decision = decisionFromAnswer(terminationColumn, { type: "noul", noul: 0.6 })!;

    expect(
      composeRationale({
        locale: "de",
        columnLabel: terminationColumn.label,
        decision,
        citationNumbers: [],
      }),
    ).toContain("Keine Belegstelle im Dokument gefunden.");
  });

  it("writes English for an English review", () => {
    const decision = decisionFromAnswer(lawColumn, {
      type: "choice",
      choice: "de",
      confidence: 0.88,
      probabilities: { de: 0.88, at: 0.1, other: 0.02 },
    })!;

    expect(
      composeRationale({
        locale: "en",
        columnLabel: "Governing law",
        decision,
        citationNumbers: [3],
      }),
    ).toBe("Governing law: Deutsches Recht Probability 88%. Evidence [3].");
  });
});

describe("decision from a large-model answer", () => {
  it("maps each column type and refuses an answer of the wrong shape", () => {
    expect(
      decisionFromModelAnswer(terminationColumn, { answerBoolean: true }, 9_100),
    ).toMatchObject({
      answerBoolean: true,
      confidenceBp: 9_100,
    });
    expect(decisionFromModelAnswer(lawColumn, { answerChoice: "at" }, 8_000)?.criterion.label).toBe(
      "Österreichisches Recht",
    );
    expect(decisionFromModelAnswer(liabilityColumn, { answerScoreLevel: 2 }, 8_000)).toMatchObject({
      answerScoreBp: 10_000,
    });

    // Eine erfundene Option, eine Stufe ausserhalb der Skala, zwei Antworten oder eine
    // Antwort vom falschen Typ darf nie still zur Antwort einer Zelle werden.
    expect(decisionFromModelAnswer(lawColumn, { answerChoice: "fr" }, 8_000)).toBeUndefined();
    expect(
      decisionFromModelAnswer(liabilityColumn, { answerScoreLevel: 3 }, 8_000),
    ).toBeUndefined();
    expect(
      decisionFromModelAnswer(
        terminationColumn,
        { answerBoolean: true, answerChoice: "de" },
        8_000,
      ),
    ).toBeUndefined();
    expect(
      decisionFromModelAnswer(terminationColumn, { answerChoice: "de" }, 8_000),
    ).toBeUndefined();
    expect(decisionFromModelAnswer(terminationColumn, {}, 8_000)).toBeUndefined();
  });
});

describe("column input", () => {
  const input = {
    label: "Anwendbares Recht",
    instructions: "Which law governs the contract?",
    criteria: {
      type: "choice" as const,
      options: [
        { label: "Deutsch", description: "German law governs." },
        { label: "Österreichisch", description: "Austrian law governs." },
      ],
    },
  };

  it("assigns option keys and keeps the hash stable for identical content", () => {
    const parsed = reviewColumnInputSchema.parse(input);
    const criteria = normalizeColumnCriteria(parsed.criteria)!;
    expect(criteria.type === "choice" && criteria.options.map((option) => option.key)).toEqual([
      "option_1",
      "option_2",
    ]);
    const hash = reviewColumnContentHash({
      label: parsed.label,
      columnType: "choice",
      instructions: parsed.instructions,
      criteria,
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      reviewColumnContentHash({
        label: parsed.label,
        columnType: "choice",
        instructions: parsed.instructions,
        criteria,
      }),
    ).toBe(hash);
    expect(
      reviewColumnContentHash({
        label: parsed.label,
        columnType: "choice",
        instructions: `${parsed.instructions} Answer strictly.`,
        criteria,
      }),
    ).not.toBe(hash);
  });

  it("refuses duplicate option keys, a single option and a too short instruction", () => {
    const duplicate = reviewColumnInputSchema.parse({
      ...input,
      criteria: {
        type: "choice",
        options: [
          { key: "de", label: "A", description: "a" },
          { key: "de", label: "B", description: "b" },
        ],
      },
    });
    expect(normalizeColumnCriteria(duplicate.criteria)).toBeUndefined();
    expect(() =>
      reviewColumnInputSchema.parse({
        ...input,
        criteria: { type: "choice", options: [{ label: "A", description: "a" }] },
      }),
    ).toThrow();
    expect(() => reviewColumnInputSchema.parse({ ...input, instructions: "kurz" })).toThrow();
  });
});
