// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  defaultMinOverlap,
  jevBatchKey,
  planJevBatches,
  summarizeJevBatches,
  type JevBatchUnit,
} from "./jev-batching";

/** Gleich grosse Blöcke, damit die Rechnung im Test nachvollziehbar bleibt. */
function blockTokens(keys: readonly string[], tokensEach = 100) {
  return new Map(keys.map((key) => [key, tokensEach]));
}

function windowUnits(count: number, blocks: readonly string[]): JevBatchUnit[] {
  return Array.from({ length: count }, (_, index) => ({
    unitId: `column-${String(index).padStart(2, "0")}`,
    blockKeys: blocks,
    questionTokens: 40,
  }));
}

describe("Jev batch planning", () => {
  it("puts every routing question about one window into a single request", () => {
    // Zwanzig Spalten fragen dasselbe Fenster ab. Ungebündelt wären das zwanzig
    // Requests und der zwanzigfache Token-Verbrauch für denselben Text.
    const blocks = ["b1", "b2", "b3"];
    const batches = planJevBatches({
      phase: "routing",
      units: windowUnits(20, blocks),
      blockTokens: blockTokens(blocks),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]!.unitIds).toHaveLength(20);
    expect(batches[0]!.blockKeys).toEqual(blocks);
    expect(summarizeJevBatches(batches)).toEqual({
      requestCount: 1,
      questionCount: 20,
      inputTokens: 340,
    });
  });

  it("never merges routing questions about different windows", () => {
    const batches = planJevBatches({
      phase: "routing",
      units: [
        { unitId: "a", blockKeys: ["b1", "b2"], questionTokens: 40 },
        { unitId: "b", blockKeys: ["b1", "b2"], questionTokens: 40 },
        { unitId: "c", blockKeys: ["b3", "b4"], questionTokens: 40 },
      ],
      blockTokens: blockTokens(["b1", "b2", "b3", "b4"]),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
    });

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.unitIds)).toEqual([["a", "b"], ["c"]]);
  });

  it("keeps decisions apart when their evidence packets barely overlap", () => {
    // Jede Zelle hätte sonst die Belege der anderen im Zustand: mehr Token und
    // eine schlechtere Belegbindung.
    const batches = planJevBatches({
      phase: "decision",
      units: [
        { unitId: "cell-a", blockKeys: ["b1", "b2", "b3", "b4"], questionTokens: 60 },
        { unitId: "cell-b", blockKeys: ["b5", "b6", "b7", "b8"], questionTokens: 60 },
      ],
      blockTokens: blockTokens(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
    });

    expect(batches).toHaveLength(2);
  });

  it("merges decisions only above the overlap threshold", () => {
    const keys = ["b1", "b2", "b3", "b4", "b5", "b6"];
    // Jaccard von {b1..b4} und {b1,b2,b3,b5} ist 3/5 = 0,6 — unter der Schwelle.
    const below = planJevBatches({
      phase: "decision",
      units: [
        { unitId: "cell-a", blockKeys: ["b1", "b2", "b3", "b4"], questionTokens: 60 },
        { unitId: "cell-b", blockKeys: ["b1", "b2", "b3", "b5"], questionTokens: 60 },
      ],
      blockTokens: blockTokens(keys),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
      minOverlap: defaultMinOverlap,
    });
    expect(below).toHaveLength(2);

    // Jaccard von {b1..b4} und {b1,b2,b3} ist 3/4 = 0,75 — darüber.
    const above = planJevBatches({
      phase: "decision",
      units: [
        { unitId: "cell-a", blockKeys: ["b1", "b2", "b3", "b4"], questionTokens: 60 },
        { unitId: "cell-b", blockKeys: ["b1", "b2", "b3"], questionTokens: 60 },
      ],
      blockTokens: blockTokens(keys),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
      minOverlap: defaultMinOverlap,
    });
    expect(above).toHaveLength(1);
    expect(above[0]!.blockKeys).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("bundles the citation check per window like routing, not per citation", () => {
    const blocks = ["b1", "b2"];
    const batches = planJevBatches({
      phase: "citation",
      units: windowUnits(16, blocks),
      blockTokens: blockTokens(blocks),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]!.unitIds).toHaveLength(16);
  });

  it("never lets a batch exceed the state budget", () => {
    const keys = Array.from({ length: 40 }, (_, index) => `b${index}`);
    const batches = planJevBatches({
      phase: "routing",
      // Alle fragen dasselbe Fenster, aber das Fenster allein ist grösser als das
      // Budget zulässt, sobald zu viele Blöcke zusammenkommen.
      units: keys.map((key) => ({ unitId: key, blockKeys: [key], questionTokens: 100 })),
      blockTokens: new Map(keys.map((key) => [key, 1_000])),
      stateTokenBudget: 4_000,
      maxQuestionsPerBatch: 24,
    });

    for (const batch of batches) {
      expect(batch.stateTokens + batch.longestQuestionTokens).toBeLessThanOrEqual(4_000);
    }
  });

  it("respects the question cap even when every unit shares one window", () => {
    const blocks = ["b1"];
    const batches = planJevBatches({
      phase: "routing",
      units: windowUnits(30, blocks),
      blockTokens: blockTokens(blocks),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
    });

    expect(batches).toHaveLength(2);
    expect(batches[0]!.unitIds).toHaveLength(24);
    expect(batches[1]!.unitIds).toHaveLength(6);
  });

  it("produces the same plan and the same batch keys for the same input", () => {
    const blocks = ["b1", "b2"];
    const input = {
      phase: "routing" as const,
      blockTokens: blockTokens(blocks),
      stateTokenBudget: 32_000,
      maxQuestionsPerBatch: 24,
    };
    const forwards = planJevBatches({ ...input, units: windowUnits(5, blocks) });
    const backwards = planJevBatches({ ...input, units: [...windowUnits(5, blocks)].reverse() });

    expect(backwards).toEqual(forwards);
  });

  it("derives the batch key from content alone, never from a step or a run", () => {
    // Ein Step-Retry nach einem Workflow-Neustart muss denselben Schlüssel
    // errechnen, sonst bezahlt er denselben Jev-Request ein zweites Mal.
    expect(jevBatchKey("routing", ["b", "a"], ["b2", "b1"])).toBe(
      jevBatchKey("routing", ["a", "b"], ["b1", "b2"]),
    );
    expect(jevBatchKey("routing", ["a"], ["b1"])).not.toBe(jevBatchKey("decision", ["a"], ["b1"]));
    expect(jevBatchKey("routing", ["a"], ["b1"])).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("returns nothing for no units instead of an empty request", () => {
    expect(
      planJevBatches({
        phase: "decision",
        units: [],
        blockTokens: new Map(),
        stateTokenBudget: 32_000,
        maxQuestionsPerBatch: 24,
      }),
    ).toEqual([]);
  });

  it("shows the saving that bundling buys", () => {
    // 50 Verträge × ein 28k-Fenster × 20 Spalten: gebündelt 50 Requests,
    // ungebündelt 1000 — und der Zustand würde zwanzigmal bezahlt.
    const blocks = ["window"];
    const tokens = new Map([["window", 28_000]]);
    const bundled = summarizeJevBatches(
      planJevBatches({
        phase: "routing",
        units: windowUnits(20, blocks),
        blockTokens: tokens,
        stateTokenBudget: 32_000,
        maxQuestionsPerBatch: 24,
      }),
    );
    const unbundled = summarizeJevBatches(
      planJevBatches({
        phase: "routing",
        units: windowUnits(20, blocks),
        blockTokens: tokens,
        stateTokenBudget: 32_000,
        maxQuestionsPerBatch: 1,
      }),
    );

    expect(bundled.requestCount).toBe(1);
    expect(unbundled.requestCount).toBe(20);
    expect(unbundled.inputTokens).toBeGreaterThan(bundled.inputTokens * 19);
  });
});
