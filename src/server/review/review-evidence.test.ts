// @vitest-environment node

import { describe, expect, it } from "vitest";

import { citationExcerpt } from "@/domain/review/citation";
import { systemOneLimits } from "@/domain/ai/system-one";

import { splitIntoSections } from "./document-sections";
import {
  applyRoutingAnswers,
  buildEvidencePacket,
  buildRetrievalEvidencePacket,
  injectionThresholdBp,
  planRouting,
  relevanceThresholdBp,
  routingUnitId,
  selectCellEvidence,
  type BlockScore,
} from "./review-evidence";
import { contractBlocks, lawColumn, liabilityColumn, terminationColumn } from "./review-fixtures";

const columns = [
  { ordinal: 1, column: terminationColumn },
  { ordinal: 2, column: lawColumn },
  { ordinal: 3, column: liabilityColumn },
];

function tokensOf(blocks: ReturnType<typeof contractBlocks>) {
  return new Map(blocks.map((block) => [block.blockKey, block.tokenCount ?? 0]));
}

describe("routing plan", () => {
  it("asks all columns and the injection question about a section in one request", () => {
    const blocks = contractBlocks();
    const sections = splitIntoSections(blocks, 2_000);
    const plan = planRouting({
      sections,
      columns,
      blockTokens: tokensOf(blocks),
      stateTokenBudget: 32_000,
    });

    expect(sections).toHaveLength(1);
    expect(plan.batches).toHaveLength(1);
    // Drei Relevanzfragen und eine Injektionsfrage teilen sich einen Zustand.
    expect(plan.batches[0]!.unitIds).toHaveLength(4);
    expect(plan.batches[0]!.unitIds).toContain(routingUnitId(0, "inj"));
    // Die Fragenschlüssel sind gültige System-One-Schlüssel.
    for (const unitId of plan.batches[0]!.unitIds)
      expect(unitId).toMatch(/^[a-z][a-z0-9_]{0,63}$/u);
  });

  it("does not send a section that alone exceeds the state budget", () => {
    const blocks = contractBlocks().map((block, index) =>
      index === 0 ? { ...block, tokenCount: 40_000 } : block,
    );
    const sections = splitIntoSections(blocks, 2_000);
    const plan = planRouting({
      sections,
      columns,
      blockTokens: tokensOf(blocks),
      stateTokenBudget: systemOneLimits.stateTokens,
    });

    // Ein gekürzter Block ergäbe ein Zitat, das im Vertrag so nicht steht.
    expect(plan.oversizedSectionIndexes).toEqual([0]);
    expect(plan.batches.flatMap((batch) => batch.blockKeys)).not.toContain("p1");
  });

  it("keeps a block in the race when the provider omits its routing answer", () => {
    const blocks = contractBlocks();
    const sections = splitIntoSections(blocks, 2_000);
    const plan = planRouting({
      sections,
      columns,
      blockTokens: tokensOf(blocks),
      stateTokenBudget: 32_000,
    });
    const scores = new Map<number, Map<string, BlockScore>>();
    applyRoutingAnswers({
      batch: plan.batches[0]!,
      answers: {},
      units: plan.units,
      sections,
      scores,
      columnOrdinals: [1, 2, 3],
    });
    // Kein Antwort heisst nicht „irrelevant": ein still verworfener Abschnitt wäre ein
    // unsichtbarer Beleg-Verlust.
    expect(scores.get(1)!.get("p2")!.relevanceBp).toBe(relevanceThresholdBp);
  });
});

function scoresFor(entries: Record<string, BlockScore>) {
  return new Map(Object.entries(entries));
}

describe("evidence packet", () => {
  const blocks = contractBlocks();

  it("takes relevant blocks by relevance and excludes those suspected of injection", () => {
    const packet = buildEvidencePacket({
      column: terminationColumn,
      blocks,
      scores: scoresFor({
        p1: { relevanceBp: 9_000, injectionBp: injectionThresholdBp },
        p2: { relevanceBp: 8_000, injectionBp: 100 },
        p3: { relevanceBp: 2_000, injectionBp: 0 },
        p4: { relevanceBp: 6_000, injectionBp: 0 },
      }),
      stateTokenBudget: 32_000,
    });

    // p1 ist am relevantesten, aber verdächtig: es erreicht weder Jev noch das grosse Modell.
    expect(packet.candidates.map((candidate) => candidate.blockKey)).toEqual(["p2", "p4"]);
    expect(packet.emptyReason).toBeUndefined();
  });

  it("never exceeds the budget and says why the packet is empty", () => {
    const huge = blocks.map((block) => ({ ...block, tokenCount: 33_000 }));
    const packet = buildEvidencePacket({
      column: terminationColumn,
      blocks: huge,
      scores: scoresFor({ p1: { relevanceBp: 9_000, injectionBp: 0 } }),
      stateTokenBudget: 32_000,
    });
    expect(packet.candidates).toEqual([]);
    expect(packet.emptyReason).toBe("first_block_too_large");
    expect(packet.stateTokenCount).toBeLessThanOrEqual(packet.budgetTokenCount);

    const none = buildEvidencePacket({
      column: terminationColumn,
      blocks,
      scores: new Map(),
      stateTokenBudget: 32_000,
    });
    expect(none.emptyReason).toBe("no_relevant_blocks");
  });

  it("has a deterministic hash for the same input", () => {
    const input = {
      column: terminationColumn,
      blocks,
      scores: scoresFor({ p2: { relevanceBp: 8_000, injectionBp: 0 } }),
      stateTokenBudget: 32_000,
    };
    expect(buildEvidencePacket(input).inputHash).toBe(buildEvidencePacket(input).inputHash);
  });
});

describe("cell evidence", () => {
  it("numbers the strongest blocks in document order and quotes them exactly", () => {
    const blocks = contractBlocks();
    const byKey = new Map(blocks.map((block) => [block.blockKey, block]));
    const evidence = selectCellEvidence({
      candidates: [
        {
          blockKey: "p3",
          documentBlockId: blocks[2]!.documentBlockId,
          relevanceBasisPoints: 9_000,
          usableBasisPoints: 9_000,
          injectionBasisPoints: 0,
          tokenCount: 40,
        },
        {
          blockKey: "p2",
          documentBlockId: blocks[1]!.documentBlockId,
          relevanceBasisPoints: 7_000,
          usableBasisPoints: 7_000,
          injectionBasisPoints: 0,
          tokenCount: 40,
        },
      ],
      blocksByKey: byKey,
      excerpt: citationExcerpt,
    });
    expect(evidence.map((entry) => [entry.citationOrder, entry.blockKey])).toEqual([
      [1, "p2"],
      [2, "p3"],
    ]);
    // Das Zitat ist ein exakter Substring des Blocks, keine Umschreibung.
    for (const entry of evidence) {
      expect(byKey.get(entry.blockKey)!.canonicalText).toContain(entry.quote);
    }
  });
});

describe("model mode retrieval", () => {
  it("builds a deterministic packet without any provider call", () => {
    const blocks = contractBlocks().map((block) => ({
      id: block.documentBlockId,
      blockKey: block.blockKey,
      ordinal: block.ordinal,
      canonicalText: block.canonicalText,
      headingPath: [] as string[],
      tokenCount: block.tokenCount,
      textHash: block.textHash,
      pageNumber: block.pageNumber,
      paragraphNumber: block.paragraphNumber,
    }));
    const plan = buildRetrievalEvidencePacket({
      column: { ...terminationColumn, label: "Kündigung aus wichtigem Grund fristlos" },
      key: "column-1",
      blocks,
    });
    expect(plan.candidates.some((candidate) => candidate.blockKey === "p2")).toBe(true);
    expect(plan.inputHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.outputHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});
