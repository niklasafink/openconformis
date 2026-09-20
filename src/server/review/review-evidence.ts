import type { SystemOneAnswer, SystemOneQuestion } from "@/domain/ai/system-one";
import { createRetrievalPacket, type RetrievalBlock } from "@/domain/analysis/retrieval";
import { createContentHash } from "@/domain/frameworks/content-hash";
import {
  decisionQuestion,
  injectionQuestion,
  relevanceQuestion,
  type ReviewColumnSnapshot,
} from "@/domain/review/column";
import type { ReviewEvidenceCandidate } from "@/server/db/schema/reviews";
import {
  blockTokenCount,
  planStateBudget,
  questionTokenCount,
  stateBudgetFor,
  type BudgetBlock,
} from "@/server/ai/system-one-budget";

import { planJevBatches, type JevBatch, type JevBatchUnit } from "./jev-batching";
import type { DocumentSection } from "./document-sections";

/**
 * Belegrouting und Belegpakete der Vertragsprüfung — reine Funktionen, ohne Datenbank
 * und ohne Netz. Sie entscheiden, welche Blöcke eine Zelle zu sehen bekommt, und
 * damit über Kosten *und* Belegqualität.
 */

/** Ab dieser Wahrscheinlichkeit gilt ein Abschnitt als einschlägig für die Spalte. */
export const relevanceThresholdBp = 4_000;
/** Ab dieser Wahrscheinlichkeit gilt ein Abschnitt als Anweisung an ein Modell. */
export const injectionThresholdBp = 5_000;

export type RoutingColumn = { ordinal: number; column: ReviewColumnSnapshot };

export type RoutingUnit = {
  unitId: string;
  sectionIndex: number;
  kind: "relevance" | "injection";
  /** Nur bei `relevance`. */
  columnOrdinal?: number;
  question: SystemOneQuestion;
};

export type RoutingPlan = {
  batches: JevBatch[];
  /** Frage je Einheit, damit ein Batch ohne Neuberechnung gesendet werden kann. */
  units: Map<string, RoutingUnit>;
  /** Abschnitte, die allein schon über dem Budget liegen und nicht geroutet werden können. */
  oversizedSectionIndexes: number[];
};

/** Fragenschlüssel: Kleinbuchstabe vorn, wie `systemOneQuestionKeySchema` es verlangt. */
export function routingUnitId(sectionIndex: number, columnOrdinal: number | "inj") {
  return columnOrdinal === "inj" ? `s${sectionIndex}_inj` : `s${sectionIndex}_c${columnOrdinal}`;
}

/**
 * Plant das Routing: je Abschnitt eine Relevanzfrage je Spalte und eine
 * Injektionsfrage, gebündelt über `planJevBatches`. Alle Fragen eines Abschnitts
 * teilen sich denselben Zustand.
 */
export function planRouting(input: {
  sections: readonly DocumentSection[];
  columns: readonly RoutingColumn[];
  blockTokens: ReadonlyMap<string, number>;
  stateTokenBudget: number;
  maxQuestionsPerBatch?: number;
}): RoutingPlan {
  const units = new Map<string, RoutingUnit>();
  const batchUnits: JevBatchUnit[] = [];
  const oversized: number[] = [];

  for (const section of input.sections) {
    const candidates: RoutingUnit[] = [
      {
        unitId: routingUnitId(section.index, "inj"),
        sectionIndex: section.index,
        kind: "injection",
        question: injectionQuestion(),
      },
      ...input.columns.map(({ ordinal, column }): RoutingUnit => ({
        unitId: routingUnitId(section.index, ordinal),
        sectionIndex: section.index,
        kind: "relevance",
        columnOrdinal: ordinal,
        question: relevanceQuestion(column),
      })),
    ];
    const longest = Math.max(...candidates.map((unit) => questionTokenCount(unit.question)));
    // Ein Abschnitt, der mit seiner längsten Frage schon das Budget sprengt, wird nicht
    // gesendet: Jev lehnte ihn ab, und ein gekürzter Block ergäbe ein falsches Zitat.
    if (section.tokenCount + longest > input.stateTokenBudget) {
      oversized.push(section.index);
      continue;
    }
    for (const unit of candidates) {
      units.set(unit.unitId, unit);
      batchUnits.push({
        unitId: unit.unitId,
        blockKeys: section.blockKeys,
        questionTokens: questionTokenCount(unit.question),
      });
    }
  }

  return {
    batches: planJevBatches({
      phase: "routing",
      units: batchUnits,
      blockTokens: input.blockTokens,
      stateTokenBudget: input.stateTokenBudget,
      maxQuestionsPerBatch: input.maxQuestionsPerBatch ?? 24,
    }),
    units,
    oversizedSectionIndexes: oversized,
  };
}

export type BlockScore = { relevanceBp: number; injectionBp: number };

function probabilityBp(answer: SystemOneAnswer | undefined) {
  if (!answer || answer.type !== "noul") return undefined;
  return Math.round(Math.min(Math.max(answer.noul, 0), 1) * 10_000);
}

/**
 * Trägt die Antworten eines Routing-Batches in die Blockbewertung ein. Eine fehlende
 * oder falsch typisierte Antwort wird **nicht** als „irrelevant" gelesen: ein still
 * verworfener Abschnitt wäre ein unsichtbarer Beleg-Verlust. Sie zählt stattdessen
 * genau an der Schwelle — der Block bleibt im Rennen, ohne zu dominieren.
 */
export function applyRoutingAnswers(input: {
  batch: JevBatch;
  answers: Record<string, SystemOneAnswer>;
  units: ReadonlyMap<string, RoutingUnit>;
  sections: readonly DocumentSection[];
  /** blockKey je Spalte → Bewertung. Wird ergänzt. */
  scores: Map<number, Map<string, BlockScore>>;
  columnOrdinals: readonly number[];
}) {
  const sectionByIndex = new Map(input.sections.map((section) => [section.index, section]));
  for (const unitId of input.batch.unitIds) {
    const unit = input.units.get(unitId);
    const section = unit ? sectionByIndex.get(unit.sectionIndex) : undefined;
    if (!unit || !section) continue;
    const value = probabilityBp(input.answers[unitId]) ?? relevanceThresholdBp;

    const ordinals = unit.kind === "injection" ? input.columnOrdinals : [unit.columnOrdinal!];
    for (const ordinal of ordinals) {
      let perBlock = input.scores.get(ordinal);
      if (!perBlock) {
        perBlock = new Map();
        input.scores.set(ordinal, perBlock);
      }
      for (const blockKey of section.blockKeys) {
        const current = perBlock.get(blockKey) ?? { relevanceBp: 0, injectionBp: 0 };
        if (unit.kind === "injection") current.injectionBp = value;
        else current.relevanceBp = value;
        perBlock.set(blockKey, current);
      }
    }
  }
}

export type PacketBlock = BudgetBlock & {
  documentBlockId: string;
  ordinal: number;
};

export type EvidencePacketPlan = {
  candidates: ReviewEvidenceCandidate[];
  stateTokenCount: number;
  budgetTokenCount: number;
  emptyReason?: string;
  inputHash: string;
  outputHash: string;
};

/**
 * Das Belegpaket einer Zelle: die einschlägigen, nicht verdächtigen Blöcke nach
 * Relevanz, bis das Budget erreicht ist. Blöcke mit Injektionsverdacht sind
 * ausgeschlossen — sie erreichen weder Jev noch das grosse Modell.
 */
export function buildEvidencePacket(input: {
  column: ReviewColumnSnapshot;
  blocks: readonly PacketBlock[];
  scores: ReadonlyMap<string, BlockScore>;
  stateTokenBudget: number;
}): EvidencePacketPlan {
  const budgetTokens = stateBudgetFor([decisionQuestion(input.column)], input.stateTokenBudget);
  const eligible = input.blocks
    .filter((block) => {
      const score = input.scores.get(block.blockKey);
      return (
        score !== undefined &&
        score.injectionBp < injectionThresholdBp &&
        score.relevanceBp >= relevanceThresholdBp
      );
    })
    .sort(
      (left, right) =>
        (input.scores.get(right.blockKey)?.relevanceBp ?? 0) -
          (input.scores.get(left.blockKey)?.relevanceBp ?? 0) || left.ordinal - right.ordinal,
    );

  const plan = planStateBudget({ blocks: eligible, budgetTokens });
  const selected = new Set(plan.blockKeys);
  const chosen = input.blocks.filter((block) => selected.has(block.blockKey));
  const candidates: ReviewEvidenceCandidate[] = chosen.map((block) => {
    const score = input.scores.get(block.blockKey) ?? { relevanceBp: 0, injectionBp: 0 };
    return {
      blockKey: block.blockKey,
      documentBlockId: block.documentBlockId,
      relevanceBasisPoints: score.relevanceBp,
      // „verwertbar": einschlägig und nicht verdächtig, als der schwächere der beiden Werte.
      usableBasisPoints: Math.min(score.relevanceBp, 10_000 - score.injectionBp),
      injectionBasisPoints: score.injectionBp,
      tokenCount: blockTokenCount(block),
    };
  });

  const emptyReason =
    candidates.length > 0
      ? undefined
      : eligible.length === 0
        ? "no_relevant_blocks"
        : (plan.emptyReason ?? "no_relevant_blocks");

  return {
    candidates,
    stateTokenCount: plan.tokenCount,
    budgetTokenCount: Math.max(budgetTokens, plan.tokenCount),
    emptyReason,
    inputHash: createContentHash({
      column: input.column,
      stateTokenBudget: input.stateTokenBudget,
      blocks: input.blocks.map((block) => ({
        blockKey: block.blockKey,
        tokens: blockTokenCount(block),
        score: input.scores.get(block.blockKey) ?? null,
      })),
    }),
    outputHash: createContentHash({ candidates, emptyReason: emptyReason ?? null }),
  };
}

/** Wie viele Belege je Zelle gezeigt und geprüft werden. */
export const evidencePerCell = 3;

export type CellEvidenceQuote = {
  citationOrder: number;
  blockKey: string;
  documentBlockId: string;
  quote: string;
};

/**
 * Die Belege, die eine Jev-Zelle trägt: die relevantesten Blöcke ihres Pakets, in
 * Dokumentreihenfolge nummeriert. Das Zitat wählt der Code (Jev gibt keinen Text
 * zurück) — der Anfang des Blocks, immer ein exakter Substring.
 */
export function selectCellEvidence(input: {
  candidates: readonly ReviewEvidenceCandidate[];
  blocksByKey: ReadonlyMap<string, PacketBlock>;
  excerpt: (canonicalText: string) => string;
  limit?: number;
}): CellEvidenceQuote[] {
  const strongest = [...input.candidates]
    .filter((candidate) => candidate.relevanceBasisPoints >= relevanceThresholdBp)
    .sort(
      (left, right) =>
        right.relevanceBasisPoints - left.relevanceBasisPoints ||
        left.blockKey.localeCompare(right.blockKey),
    )
    .slice(0, input.limit ?? evidencePerCell);

  return strongest
    .map((candidate) => ({ candidate, block: input.blocksByKey.get(candidate.blockKey) }))
    .filter(
      (entry): entry is { candidate: ReviewEvidenceCandidate; block: PacketBlock } =>
        entry.block !== undefined,
    )
    .sort((left, right) => left.block.ordinal - right.block.ordinal)
    .map(({ candidate, block }, index) => ({
      citationOrder: index + 1,
      blockKey: candidate.blockKey,
      documentBlockId: candidate.documentBlockId,
      quote: input.excerpt(block.canonicalText),
    }));
}

/**
 * Modellmodus: die Spalte als Anforderung für die bestehende lexikalische Suche
 * (`createRetrievalPacket`). Instruktionen und Kriterien sind englisch, der Vertrag
 * ist deutsch — deshalb tragen die Beschriftungen in der Sprache des Nutzers das
 * Gewicht (Titel und Prüfaspekte), die englische Anweisung nur den Fliesstext.
 */
export function retrievalRequirementFor(column: ReviewColumnSnapshot, key: string) {
  const { criteria } = column;
  const criterionLabels =
    criteria.type === "noul"
      ? [criteria.true, criteria.false]
      : criteria.type === "choice"
        ? criteria.options
        : criteria.levels;
  return {
    externalKey: key,
    regulatoryId: key,
    title: column.label,
    legalText: column.instructions,
    assessmentAspects: criterionLabels.flatMap((criterion) => [criterion.label]),
    sizeGuidance: "",
    subrequirements: [],
  };
}

export type RetrievalBlockInput = RetrievalBlock;

/** Das Belegpaket einer Zelle im Modellmodus, deterministisch und ohne Modellaufruf. */
export function buildRetrievalEvidencePacket(input: {
  column: ReviewColumnSnapshot;
  key: string;
  blocks: readonly RetrievalBlock[];
}): EvidencePacketPlan {
  const packet = createRetrievalPacket(
    retrievalRequirementFor(input.column, input.key),
    input.blocks,
  );
  const candidates: ReviewEvidenceCandidate[] = packet.candidates.map((candidate) => ({
    blockKey: candidate.blockKey,
    documentBlockId: candidate.id,
    relevanceBasisPoints: candidate.scoreBasisPoints,
    usableBasisPoints: candidate.scoreBasisPoints,
    injectionBasisPoints: 0,
    tokenCount: candidate.tokenCount ?? 0,
  }));
  return {
    candidates,
    stateTokenCount: packet.tokenCount,
    budgetTokenCount: Math.max(6_000, packet.tokenCount),
    emptyReason: candidates.length === 0 ? "no_relevant_blocks" : undefined,
    inputHash: packet.inputHash,
    outputHash: packet.outputHash,
  };
}
