import { createContentHash } from "@/domain/frameworks/content-hash";

/**
 * Batch-Planung für die Vertragsprüfung. Eine reine Funktion ohne Datenbank, Netz
 * oder Uhr — sie entscheidet über Laufzeit **und** Rechnung, und ein Denkfehler
 * darin würde erst bei tausend Zellen sichtbar. Deshalb steht sie hier allein und
 * wird zuerst getestet.
 *
 * Der Zustand wird einmal bezahlt, die Fragen daran sind fast gratis. Daraus folgen
 * zwei entgegengesetzte Regeln:
 *
 * - **Routing und Zitatprüfung bündeln.** Alle Spalten fragen *dasselbe*
 *   Dokumentfenster ab. Ungebündelt wären es bei 20 Spalten zwanzigmal so viele
 *   Requests und zwanzigmal so viele Eingabe-Token für denselben Text.
 * - **Entscheidungen nicht bündeln.** Jede Zelle hat ihr *eigenes* Belegpaket. Drei
 *   Zellen in einen Zustand zu packen hiesse, jeder Frage die Belege der anderen
 *   mitzuschicken: mehr Token *und* schlechtere Belegbindung. Einzige Ausnahme sind
 *   Zellen, deren Blockmengen sich stark überlappen — dort ist die Vereinigung kaum
 *   grösser als jedes einzelne Paket.
 */

export type JevBatchPhase = "routing" | "decision" | "citation";

export type JevBatchUnit = {
  /** Eindeutig innerhalb der Phase: die Zelle, das Fenster oder das geprüfte Zitat. */
  unitId: string;
  /** Die Blöcke, aus denen der Zustand dieser Einheit besteht. */
  blockKeys: readonly string[];
  /** Tokenkosten der Frage dieser Einheit. */
  questionTokens: number;
};

export type JevBatch = {
  phase: JevBatchPhase;
  /** Die Einheiten, die sich einen Zustand teilen. Reihenfolge ist deterministisch. */
  unitIds: string[];
  /** Vereinigung der Blöcke — genau der Zustand, der gesendet wird. */
  blockKeys: string[];
  stateTokens: number;
  /** Die längste Frage des Batches; sie bestimmt zusammen mit dem Zustand die Grenze. */
  longestQuestionTokens: number;
  /**
   * Deterministisch aus Phase und Inhalt gehasht — **nicht** aus der Step-ID. Sonst
   * griffe die Bezahl-Idempotenz über einen Workflow-Neustart hinweg nicht und jeder
   * Step-Retry bezahlte denselben Jev-Request erneut.
   */
  batchKey: string;
};

export type PlanJevBatchesInput = {
  phase: JevBatchPhase;
  units: readonly JevBatchUnit[];
  /** Tokenkosten je Block. Ein Block, der in zwei Einheiten steckt, zählt einmal. */
  blockTokens: ReadonlyMap<string, number>;
  /** Obergrenze für Zustand plus längste Frage. */
  stateTokenBudget: number;
  maxQuestionsPerBatch: number;
  /**
   * Nur für `decision`: ab welcher Überlappung zwei Belegpakete zusammendürfen.
   * Gemessen als Jaccard-Index über die Blockmengen.
   */
  minOverlap?: number;
};

export const defaultMinOverlap = 0.7;
export const defaultMaxQuestionsPerBatch = 24;

function sumTokens(blockKeys: Iterable<string>, blockTokens: ReadonlyMap<string, number>) {
  let total = 0;
  for (const key of blockKeys) total += blockTokens.get(key) ?? 0;
  return total;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const key of right) if (left.has(key)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 1 : shared / union;
}

/** Der Batch-Schlüssel hängt ausschliesslich am Inhalt, damit er Neustarts überlebt. */
export function jevBatchKey(
  phase: JevBatchPhase,
  unitIds: readonly string[],
  blockKeys: readonly string[],
): string {
  return createContentHash({
    phase,
    units: [...unitIds].sort(),
    blocks: [...blockKeys].sort(),
  });
}

type OpenBatch = { unitIds: string[]; blocks: Set<string>; longestQuestionTokens: number };

function seal(phase: JevBatchPhase, batch: OpenBatch, blockTokens: ReadonlyMap<string, number>) {
  // Blockreihenfolge stabil halten: der Zustand soll bei gleichem Inhalt gleich
  // aussehen, sonst wäre der Batch-Schlüssel stabil, der Zustand aber nicht.
  const blockKeys = [...batch.blocks].sort();
  return {
    phase,
    unitIds: [...batch.unitIds],
    blockKeys,
    stateTokens: sumTokens(blockKeys, blockTokens),
    longestQuestionTokens: batch.longestQuestionTokens,
    batchKey: jevBatchKey(phase, batch.unitIds, blockKeys),
  } satisfies JevBatch;
}

/**
 * Passt die Einheit noch in den Batch, ohne die Grenze zu reissen? Gerechnet wird
 * gegen *Zustand plus längste Frage*, nicht gegen den Kontext: das ist die Grenze,
 * an der TypeSafe tatsächlich ablehnt.
 */
function fits(
  batch: OpenBatch,
  unit: JevBatchUnit,
  blockTokens: ReadonlyMap<string, number>,
  stateTokenBudget: number,
) {
  const union = new Set(batch.blocks);
  for (const key of unit.blockKeys) union.add(key);
  const longestQuestion = Math.max(batch.longestQuestionTokens, unit.questionTokens);
  return sumTokens(union, blockTokens) + longestQuestion <= stateTokenBudget;
}

export function planJevBatches(input: PlanJevBatchesInput): JevBatch[] {
  const {
    phase,
    blockTokens,
    stateTokenBudget,
    maxQuestionsPerBatch,
    minOverlap = defaultMinOverlap,
  } = input;

  // Deterministische Reihenfolge: dieselbe Eingabe muss dieselben Batches und
  // damit dieselben Batch-Schlüssel ergeben, sonst zahlt ein Neustart doppelt.
  const units = [...input.units].sort((left, right) => left.unitId.localeCompare(right.unitId));
  const batches: JevBatch[] = [];
  const open: OpenBatch[] = [];

  for (const unit of units) {
    const unitBlocks = new Set(unit.blockKeys);
    const candidate = open.find((batch) => {
      if (batch.unitIds.length >= maxQuestionsPerBatch) return false;
      if (!fits(batch, unit, blockTokens, stateTokenBudget)) return false;
      // Routing und Zitatprüfung teilen sich ein Fenster: identische Blockmengen
      // gehören zusammen, verschiedene nie.
      if (phase !== "decision") return jaccard(batch.blocks, unitBlocks) === 1;
      return jaccard(batch.blocks, unitBlocks) >= minOverlap;
    });

    if (candidate) {
      candidate.unitIds.push(unit.unitId);
      for (const key of unit.blockKeys) candidate.blocks.add(key);
      candidate.longestQuestionTokens = Math.max(
        candidate.longestQuestionTokens,
        unit.questionTokens,
      );
      continue;
    }

    open.push({
      unitIds: [unit.unitId],
      blocks: unitBlocks,
      longestQuestionTokens: unit.questionTokens,
    });
  }

  for (const batch of open) batches.push(seal(phase, batch, blockTokens));
  return batches;
}

/**
 * Was ein Plan kostet. Die Eskalationsquote ist der eigentliche Kostenhebel, nicht
 * Jev — diese Zahl macht das in der Kennzahlenzeile sichtbar, statt es zu behaupten.
 */
export function summarizeJevBatches(batches: readonly JevBatch[]) {
  return {
    requestCount: batches.length,
    questionCount: batches.reduce((total, batch) => total + batch.unitIds.length, 0),
    inputTokens: batches.reduce(
      (total, batch) => total + batch.stateTokens + batch.longestQuestionTokens,
      0,
    ),
  };
}
