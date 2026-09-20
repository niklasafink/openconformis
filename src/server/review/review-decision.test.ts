// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { SystemOneAnswer, SystemOneQuestion } from "@/domain/ai/system-one";
import type { ReviewModelAnswer } from "@/domain/review/model-answer";
import { ModelProviderError } from "@/server/ai/structured-model";
import type { ReviewEvidenceCandidate } from "@/server/db/schema/reviews";

import {
  decideJevCells,
  decideModelCells,
  type CellSettlement,
  type DecisionCell,
  type DecisionConfig,
  type DecisionPorts,
  type JevBatchCall,
} from "./review-decision";
import { contractBlocks, lawColumn, liabilityColumn, terminationColumn } from "./review-fixtures";

const blocks = contractBlocks();
const blocksByKey = new Map(blocks.map((block) => [block.blockKey, block]));

const config: DecisionConfig = {
  locale: "de",
  stateTokenBudget: 32_000,
  escalationThresholdBp: 7_500,
  citationAcceptThresholdBp: 8_000,
  escalationBudgetCells: 10,
  modelId: "test/big-model",
};

function candidate(blockKey: string, relevanceBasisPoints = 9_000): ReviewEvidenceCandidate {
  const block = blocksByKey.get(blockKey)!;
  return {
    blockKey,
    documentBlockId: block.documentBlockId,
    relevanceBasisPoints,
    usableBasisPoints: relevanceBasisPoints,
    injectionBasisPoints: 0,
    tokenCount: 40,
  };
}

function cell(
  id: string,
  column: DecisionCell["column"],
  blockKeys: string[],
  emptyReason?: string,
): DecisionCell {
  return {
    cellId: id,
    column,
    candidates: blockKeys.map((key) => candidate(key)),
    emptyReason,
    packetInputHash: "a".repeat(64),
  };
}

type Script = {
  /** Antwort auf die Entscheidungsfrage je Spalte (über die Anweisung erkannt). */
  decision: (question: SystemOneQuestion) => SystemOneAnswer;
  citation?: (question: SystemOneQuestion) => SystemOneAnswer;
};

const supports = (confidence = 0.95): SystemOneAnswer => ({
  type: "choice",
  choice: "supports",
  confidence,
  probabilities: { supports: confidence, contradicts: 0, silent: 1 - confidence },
});

const confidentDecision = (question: SystemOneQuestion): SystemOneAnswer => {
  if (question.type === "noul") return { type: "noul", noul: 0.97 };
  if (question.type === "choice") {
    return {
      type: "choice",
      choice: "de",
      confidence: 0.96,
      probabilities: { de: 0.96, at: 0.04 },
    };
  }
  return {
    type: "score",
    score: 2,
    confidence: 0.9,
    probabilities: { "0": 0.02, "1": 0.08, "2": 0.9 },
  };
};

function harness(overrides: Partial<DecisionPorts> = {}, script?: Partial<Script>) {
  const jevCalls: JevBatchCall[] = [];
  const settlements: CellSettlement[] = [];
  const escalated = new Set<string>();
  const modelCalls: Array<{ cellId: string; attempt: number; system: string }> = [];

  const ports: DecisionPorts = {
    askJev: async (call) => {
      jevCalls.push(call);
      return Object.fromEntries(
        Object.entries(call.questions).map(([key, question]) => [
          key,
          call.phase === "citation"
            ? (script?.citation ?? (() => supports()))(question)
            : (script?.decision ?? confidentDecision)(question),
        ]),
      );
    },
    askModel: async (call) => {
      modelCalls.push({ cellId: call.cellId, attempt: call.attempt, system: call.system });
      return { output: modelAnswer(), modelId: "test/big-model" };
    },
    escalationsUsed: async () => escalated.size,
    reserveEscalation: async (cellId) => {
      if (escalated.has(cellId)) return true;
      if (escalated.size >= config.escalationBudgetCells) return false;
      escalated.add(cellId);
      return true;
    },
    settle: async (settlement) => {
      settlements.push(settlement);
    },
    isCellLevelFailure: (error) =>
      error instanceof ModelProviderError && error.code === "MODEL_OUTPUT_INVALID"
        ? error.code
        : undefined,
    ...overrides,
  };
  return { ports, jevCalls, settlements, modelCalls, escalated };
}

function modelAnswer(overrides: Partial<ReviewModelAnswer> = {}): ReviewModelAnswer {
  return {
    answerBoolean: true,
    answerChoice: null,
    answerScoreLevel: null,
    confidencePercent: 92,
    rationale: "Der Vertrag räumt beiden Parteien ein Kündigungsrecht ein [1].",
    citations: [
      {
        blockKey: "p2",
        exactQuote: "Jede Partei kann den Vertrag aus wichtigem Grund fristlos kündigen.",
        support: "supports",
      },
    ],
    ...overrides,
  };
}

const jevOf = (settlements: CellSettlement[], id: string) =>
  settlements.find((settlement) => settlement.cellId === id)!;

describe("Jev decision", () => {
  it("settles a confident, verified cell as complete with a composed rationale", async () => {
    const { ports, settlements, modelCalls } = harness();
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });

    const result = jevOf(settlements, "c1");
    expect(result.state).toBe("complete");
    expect(result.source).toBe("jev");
    expect(result.decision?.answerBoolean).toBe(true);
    expect(result.citationVerdict).toBe("verified");
    expect(result.evidence.map((row) => [row.citationOrder, row.support])).toEqual([
      [1, "supports"],
    ]);
    // Die Begründung setzt Code aus Beschriftung, Kriterium, Wahrscheinlichkeit und Beleg zusammen.
    expect(result.rationale).toBe(
      "Kündigung aus wichtigem Grund: Ja, ausdrücklich geregelt Wahrscheinlichkeit 97 %. Beleg [1].",
    );
    expect(modelCalls).toHaveLength(0);
  });

  it("does not call the large model above the threshold", async () => {
    const { ports, modelCalls, settlements } = harness();
    await decideJevCells({
      cells: [cell("c1", lawColumn, ["p1"]), cell("c2", liabilityColumn, ["p3"])],
      blocksByKey,
      config,
      ports,
    });
    expect(modelCalls).toHaveLength(0);
    expect(settlements.every((settlement) => settlement.state === "complete")).toBe(true);
  });

  it("escalates a cell below the threshold and takes the model's answer and rationale", async () => {
    const { ports, modelCalls, settlements, escalated } = harness(
      {},
      { decision: () => ({ type: "noul", noul: 0.62 }) },
    );
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });

    expect(modelCalls).toHaveLength(1);
    expect(escalated.has("c1")).toBe(true);
    const result = jevOf(settlements, "c1");
    expect(result.source).toBe("escalation_model");
    expect(result.state).toBe("complete");
    expect(result.rationale).toBe("Der Vertrag räumt beiden Parteien ein Kündigungsrecht ein [1].");
    // Beleg und Nummer der Begründung stimmen überein.
    expect(result.evidence.map((row) => row.citationOrder)).toEqual([1]);
  });

  it("keeps the Jev answer as needs_review when the escalation budget is exhausted", async () => {
    const { ports, modelCalls, settlements } = harness(
      {},
      { decision: () => ({ type: "noul", noul: 0.62 }) },
    );
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config: { ...config, escalationBudgetCells: 0 },
      ports,
    });

    expect(modelCalls).toHaveLength(0);
    const result = jevOf(settlements, "c1");
    // Sichtbar offen, nicht still erledigt.
    expect(result.state).toBe("needs_review");
    expect(result.source).toBe("jev");
    expect(result.decision?.answerBoolean).toBe(true);
  });

  it("resumes a cell whose escalation slot an earlier attempt already took", async () => {
    const { ports, modelCalls, settlements, escalated } = harness(
      {},
      { decision: () => ({ type: "noul", noul: 0.55 }) },
    );
    // Der frühere Anlauf hat den einzigen Platz belegt und ist vor der Antwort gestorben.
    escalated.add("c1");
    await decideJevCells({
      cells: [{ ...cell("c1", terminationColumn, ["p2"]), alreadyEscalated: true }],
      blocksByKey,
      config: { ...config, escalationBudgetCells: 1 },
      ports,
    });
    // Das Budget ist „erschöpft" — durch genau diese Zelle. Sie wird trotzdem abgeschlossen.
    expect(modelCalls).toHaveLength(1);
    expect(jevOf(settlements, "c1").source).toBe("escalation_model");
    expect(escalated.size).toBe(1);
  });

  it("rejects a quote that is not in the document without asking any model", async () => {
    const { ports, jevCalls, modelCalls, settlements } = harness();
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config: { ...config, escalationBudgetCells: 0 },
      ports,
      excerpt: () => "Dieses Zitat steht nirgends im Vertrag.",
    });

    // Es gab keine Zitatprüfung und kein grosses Modell — nur die Entscheidungsfrage.
    expect(jevCalls.map((call) => call.phase)).toEqual(["decision"]);
    expect(modelCalls).toHaveLength(0);
    const result = jevOf(settlements, "c1");
    expect(result.citationVerdict).toBe("fabricated");
    // Nie ein stilles „complete", und das erfundene Zitat steht nicht als Beleg da.
    expect(result.state).toBe("needs_review");
    expect(result.evidence).toEqual([]);
    expect(result.rationale).toContain("Keine Belegstelle");
  });

  it("puts a contradicting citation on review even at high confidence", async () => {
    const { ports, settlements } = harness(
      {},
      {
        citation: () => ({
          type: "choice",
          choice: "contradicts",
          confidence: 0.99,
          probabilities: { supports: 0, contradicts: 0.99, silent: 0.01 },
        }),
      },
    );
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config: { ...config, escalationBudgetCells: 0 },
      ports,
    });
    const result = jevOf(settlements, "c1");
    expect(result.state).toBe("needs_review");
    expect(result.citationVerdict).toBe("contradicted");
    expect(result.evidence[0]!.support).toBe("contradicts");
  });

  it("accepts a supporting citation only above the acceptance threshold", async () => {
    const { ports, settlements } = harness({}, { citation: () => supports(0.7) });
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config: { ...config, escalationBudgetCells: 0 },
      ports,
    });
    expect(jevOf(settlements, "c1").state).toBe("needs_review");
  });

  it("sends a cell without any relevant passage to review, never to the large model", async () => {
    const { ports, settlements, modelCalls } = harness();
    await decideJevCells({
      cells: [cell("c1", terminationColumn, [], "no_relevant_blocks")],
      blocksByKey,
      config,
      ports,
    });
    const result = jevOf(settlements, "c1");
    expect(modelCalls).toHaveLength(0);
    expect(result.state).toBe("needs_review");
    expect(result.evidence).toEqual([]);
    expect(result.rationale).toContain("Keine Belegstelle im Dokument gefunden.");
  });

  it("bundles the citation checks of cells that quote the same passage", async () => {
    const { ports, jevCalls } = harness();
    await decideJevCells({
      cells: [cell("c1", terminationColumn, ["p2"]), cell("c2", lawColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });
    const citation = jevCalls.filter((call) => call.phase === "citation");
    expect(citation).toHaveLength(1);
    expect(Object.keys(citation[0]!.questions)).toHaveLength(2);
    // Und die Entscheidungen bei gleichem Belegpaket teilen sich einen Zustand.
    expect(jevCalls.filter((call) => call.phase === "decision")).toHaveLength(1);
  });

  it("marks an answer that does not fit the question as failed when nothing can be escalated", async () => {
    const { ports, settlements } = harness({}, { decision: () => ({ type: "noul", noul: 0.9 }) });
    // Die Spalte fragt nach einer Auswahl, Jev antwortet mit ja/nein.
    await decideJevCells({
      cells: [cell("c1", lawColumn, ["p1"])],
      blocksByKey,
      config: { ...config, escalationBudgetCells: 0 },
      ports,
    });
    expect(jevOf(settlements, "c1")).toMatchObject({
      state: "failed",
      failureCode: "JEV_ANSWER_INVALID",
    });
  });
});

describe("large model answer", () => {
  it("uses its own rationale only when the numbers match the citations", async () => {
    const { ports, settlements } = harness({
      askModel: async () => ({
        output: modelAnswer({ rationale: "Belegt durch [1] und [3]." }),
        modelId: "test/big-model",
      }),
    });
    await decideModelCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });
    const result = jevOf(settlements, "c1");
    // Es gibt nur einen Beleg; `[3]` hat keinen. Die zusammengesetzte Fassung gilt.
    expect(result.rationale).not.toContain("[3]");
    expect(result.rationale).toBe(
      "Kündigung aus wichtigem Grund: Ja, ausdrücklich geregelt Wahrscheinlichkeit 92 %. Beleg [1].",
    );
  });

  it("drops a fabricated quote, retries once with a hint and then needs review", async () => {
    const askModel = vi.fn(async () => ({
      output: modelAnswer({
        citations: [
          { blockKey: "p2", exactQuote: "Frei erfundener Vertragssatz.", support: "supports" },
        ],
      }),
      modelId: "test/big-model",
    }));
    const { ports, settlements } = harness({ askModel });
    await decideModelCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });
    expect(askModel).toHaveBeenCalledTimes(2);
    const retryHint = (askModel.mock.calls as unknown as Array<[{ system: string }]>)[1]![0].system;
    expect(retryHint).toContain("copied verbatim");
    const result = jevOf(settlements, "c1");
    expect(result.citationVerdict).toBe("fabricated");
    expect(result.state).toBe("needs_review");
    expect(result.evidence).toEqual([]);
  });

  it("rejects a quote from a block that was not in the cell's packet", async () => {
    const { ports, settlements } = harness({
      askModel: async () => ({
        output: modelAnswer({
          // p4 steht im Vertrag, aber nicht im Belegpaket dieser Zelle.
          citations: [
            {
              blockKey: "p4",
              exactQuote: "Änderungen dieses Vertrags bedürfen der Schriftform.",
              support: "supports",
            },
          ],
          rationale: "Es gibt eine Klausel zur Schriftform, die hier nicht einschlägig ist.",
        }),
        modelId: "test/big-model",
      }),
    });
    await decideModelCells({
      cells: [cell("c1", terminationColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });
    expect(jevOf(settlements, "c1").citationVerdict).toBe("fabricated");
  });

  it("fails only the one cell when the model returns an unusable answer", async () => {
    const { ports, settlements } = harness({
      askModel: async (call) => {
        if (call.cellId === "bad") throw new ModelProviderError("MODEL_OUTPUT_INVALID", false);
        return { output: modelAnswer(), modelId: "test/big-model" };
      },
    });
    await decideModelCells({
      cells: [cell("bad", terminationColumn, ["p2"]), cell("good", terminationColumn, ["p2"])],
      blocksByKey,
      config,
      ports,
    });
    expect(jevOf(settlements, "bad")).toMatchObject({
      state: "failed",
      failureCode: "MODEL_OUTPUT_INVALID",
    });
    expect(jevOf(settlements, "good").state).toBe("complete");
  });

  it("lets a provider outage that affects the whole run escape instead of failing the cell", async () => {
    const { ports } = harness({
      askModel: async () => {
        throw new ModelProviderError("PROVIDER_CREDENTIAL_INVALID", false);
      },
    });
    await expect(
      decideModelCells({
        cells: [cell("c1", terminationColumn, ["p2"])],
        blocksByKey,
        config,
        ports,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_INVALID" });
  });
});

describe("model mode without Jev", () => {
  it("runs a complete grid through the model and never touches Jev", async () => {
    const askJev = vi.fn(async () => {
      throw new Error("TypeSafe must not be called in model mode");
    });
    const { ports, settlements, modelCalls } = harness({ askJev });
    const cells = [
      cell("c1", terminationColumn, ["p2"]),
      cell("c2", lawColumn, ["p1"]),
      cell("c3", liabilityColumn, ["p3"]),
      cell("c4", terminationColumn, [], "no_relevant_blocks"),
    ];
    ports.askModel = async (call) => {
      modelCalls.push({ cellId: call.cellId, attempt: call.attempt, system: call.system });
      const byCell: Record<string, ReviewModelAnswer> = {
        c1: modelAnswer(),
        c2: modelAnswer({
          answerBoolean: null,
          answerChoice: "de",
          rationale: "Deutsches Recht ist vereinbart [1].",
          citations: [
            {
              blockKey: "p1",
              exactQuote: "Dieser Vertrag unterliegt deutschem Recht",
              support: "supports",
            },
          ],
        }),
        c3: modelAnswer({
          answerBoolean: null,
          answerScoreLevel: 2,
          rationale: "Die Haftung ist streng begrenzt [1].",
          citations: [
            {
              blockKey: "p3",
              exactQuote: "die Gesamthaftung ist auf die Jahresvergütung beschränkt",
              support: "supports",
            },
          ],
        }),
        c4: modelAnswer({
          answerBoolean: false,
          confidencePercent: 40,
          rationale: "Der Vertrag enthält dazu nichts.",
          citations: [],
        }),
      };
      return { output: byCell[call.cellId]!, modelId: "test/big-model" };
    };

    await decideModelCells({ cells, blocksByKey, config, ports });

    expect(askJev).not.toHaveBeenCalled();
    expect(modelCalls).toHaveLength(4);
    expect(settlements).toHaveLength(4);
    expect(settlements.every((settlement) => settlement.source === "escalation_model")).toBe(true);
    expect(jevOf(settlements, "c1").state).toBe("complete");
    expect(jevOf(settlements, "c2").decision?.answerChoice).toBe("de");
    expect(jevOf(settlements, "c3").decision?.answerScoreBp).toBe(10_000);
    // Ohne Beleg und mit geringer Konfidenz: prüfbedürftig, mit ausdrücklicher Leermeldung.
    const silent = jevOf(settlements, "c4");
    expect(silent.state).toBe("needs_review");
    expect(silent.rationale).toContain("Keine Belegstelle im Dokument gefunden.");
  });
});
