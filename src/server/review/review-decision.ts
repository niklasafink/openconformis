import {
  answerMatchesQuestion,
  type SystemOneAnswer,
  type SystemOneQuestion,
} from "@/domain/ai/system-one";
import {
  citationCheckFromAnswer,
  cellCitationOutcome,
  citationExcerpt,
  groundCitation,
  type CitationBlock,
  type CitationCheck,
  type CitationVerdict,
} from "@/domain/review/citation";
import {
  citationQuestion,
  composeRationale,
  decisionFromAnswer,
  decisionFromModelAnswer,
  decisionQuestion,
  noEvidenceMessage,
  type ReviewColumnSnapshot,
  type ReviewDecision,
  type ReviewLocale,
} from "@/domain/review/column";
import { cellStateAfterDecision, decideEscalation } from "@/domain/review/escalation";
import {
  buildReviewDecisionPrompt,
  rationaleMatchesCitations,
  type ReviewModelAnswer,
} from "@/domain/review/model-answer";
import type { ReviewEvidenceCandidate } from "@/server/db/schema/reviews";
import {
  composeState,
  estimateTokenCount,
  questionTokenCount,
} from "@/server/ai/system-one-budget";

import { planJevBatches, type JevBatch, type JevBatchPhase } from "./jev-batching";
import { selectCellEvidence } from "./review-evidence";
import { createContentHash } from "@/domain/frameworks/content-hash";

/**
 * Die Entscheidung einer Zelle. Die Logik steht hier, getrennt von Datenbank und
 * Netz: alles, was nach aussen geht, kommt über die `DecisionPorts`. Dadurch lässt
 * sich die Regelkette — Substring-Check, Zitatprüfung, Eskalation, Budget — ohne
 * einen einzigen echten Aufruf prüfen, und der Modellmodus beweist, dass er ohne
 * TypeSafe auskommt: sein Port `askJev` wird nie berührt.
 */

/** Ein Block des Vertrags mit allem, was Zitat und Beleg brauchen. */
export type ReviewBlock = CitationBlock & { ordinal: number; tokenCount: number | null };

export type DecisionConfig = {
  locale: ReviewLocale;
  stateTokenBudget: number;
  escalationThresholdBp: number;
  citationAcceptThresholdBp: number;
  escalationBudgetCells: number;
  /** Das grosse Modell: Eskalation im Jev-Modus, alle Zellen im Modellmodus. */
  modelId: string;
};

export type DecisionCell = {
  cellId: string;
  column: ReviewColumnSnapshot;
  /** Das gespeicherte Belegpaket der Zelle. */
  candidates: readonly ReviewEvidenceCandidate[];
  emptyReason?: string;
  packetInputHash: string;
  /**
   * Ein früherer Anlauf hat den Eskalationsplatz dieser Zelle schon belegt und ist vor
   * der Antwort des grossen Modells gestorben. Der Platz zählt weiter; ohne diese Angabe
   * fände der Wiederanlauf das Budget „erschöpft" — durch genau diese Zelle.
   */
  alreadyEscalated?: boolean;
};

export type EvidenceRow = {
  documentBlockId: string;
  citationOrder: number;
  support: "supports" | "contradicts" | "context";
  exactQuote: string;
  blockTextHash: string;
  pageNumber: number | null;
  paragraphNumber: number | null;
};

export type CellSettlement = {
  cellId: string;
  state: "complete" | "needs_review" | "failed";
  source?: "jev" | "escalation_model";
  decision?: ReviewDecision;
  rationale?: string;
  citationVerdict?: CitationVerdict;
  decisionModelId?: string;
  inputHash?: string;
  outputHash?: string;
  failureCode?: string;
  evidence: EvidenceRow[];
};

export type JevBatchCall = {
  phase: JevBatchPhase;
  batchKey: string;
  /** Nur bei genau einer Zelle im Batch. */
  cellId?: string;
  state: string;
  questions: Record<string, SystemOneQuestion>;
  estimatedInputTokens: number;
};

export type ModelCall = {
  cellId: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  outputSchema: import("zod").ZodType<ReviewModelAnswer>;
  attempt: number;
};

export type DecisionPorts = {
  /** Beantwortet einen Jev-Batch. Im Modellmodus wird er nie aufgerufen. */
  askJev: (call: JevBatchCall) => Promise<Record<string, SystemOneAnswer>>;
  /** Ruft das grosse Modell. Wirft bei Anbieterfehlern. */
  askModel: (call: ModelCall) => Promise<{ output: ReviewModelAnswer; modelId: string }>;
  /** Wie viele Zellen dieses Laufs bereits eskaliert wurden. */
  escalationsUsed: () => Promise<number>;
  /**
   * Belegt den Eskalationsplatz der Zelle atomar. Idempotent: eine Zelle, die schon
   * als eskaliert geführt wird, gibt `true` zurück und verbraucht keinen zweiten Platz.
   */
  reserveEscalation: (cellId: string) => Promise<boolean>;
  settle: (settlement: CellSettlement) => Promise<void>;
  /** Ist der Fehler ein Fehlschlag dieser einen Zelle statt des ganzen Laufs? */
  isCellLevelFailure: (error: unknown) => string | undefined;
};

export const noPassageState = "(No passage of the contract is relevant to this question.)";

function claimFor(column: ReviewColumnSnapshot, decision: ReviewDecision) {
  return `Question: ${column.instructions} Answer: ${decision.criterion.description}`;
}

function supportOf(verdict: CitationVerdict): EvidenceRow["support"] {
  if (verdict === "verified") return "supports";
  if (verdict === "contradicted") return "contradicts";
  return "context";
}

function evidenceRowOf(
  block: CitationBlock,
  order: number,
  quote: string,
  verdict: CitationVerdict,
) {
  return {
    documentBlockId: block.documentBlockId,
    citationOrder: order,
    support: supportOf(verdict),
    exactQuote: quote,
    blockTextHash: block.textHash,
    pageNumber: block.pageNumber,
    paragraphNumber: block.paragraphNumber,
  } satisfies EvidenceRow;
}

/** Hält höchstens `limit` Aufgaben gleichzeitig offen. Die Reihenfolge der Ergebnisse bleibt. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await work(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type JevDecided = {
  cell: DecisionCell;
  decision: ReviewDecision;
  rows: Array<{ order: number; block: CitationBlock; quote: string; fabricated: boolean }>;
  /** Ein Urteil je Beleg, in derselben Reihenfolge wie `rows`. */
  checks: CitationCheck[];
  inputHash: string;
  outputHash: string;
};

/* -------------------------------------------------------------------------- */
/* Grosses Modell: Eskalation im Jev-Modus, jede Zelle im Modellmodus.         */
/* -------------------------------------------------------------------------- */

type ModelAttemptResult = { kind: "settled"; settlement: CellSettlement } | { kind: "unusable" };

/**
 * Lässt das grosse Modell eine Zelle beantworten und prüft, was es zurückgibt.
 *
 * - Die Antwort muss zum Spaltentyp passen (eine erfundene Option scheitert).
 * - Jedes Zitat muss ein exakter Substring eines Blocks **des Belegpakets** sein. Ein
 *   erfundenes wird verworfen, ohne dass irgendjemand nachfragt; nur der einmalige
 *   zweite Versuch bekommt einen Hinweis.
 * - Die Begründung des Modells gilt nur, wenn ihre Belegnummern zu den behaltenen
 *   Belegen passen. Sonst wird sie aus dem Kriterium zusammengesetzt.
 */
async function askModelForCell(
  cell: DecisionCell,
  blocksByKey: ReadonlyMap<string, ReviewBlock>,
  config: DecisionConfig,
  ports: DecisionPorts,
): Promise<ModelAttemptResult> {
  const packetBlocks = cell.candidates
    .map((candidate) => blocksByKey.get(candidate.blockKey))
    .filter((block): block is ReviewBlock => block !== undefined)
    .sort((left, right) => left.ordinal - right.ordinal);
  const packetKeys = new Map(packetBlocks.map((block) => [block.blockKey, block]));

  let retryHint: string | undefined;
  let lastFabricated: CellSettlement | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const prompt = buildReviewDecisionPrompt({
      locale: config.locale,
      column: cell.column,
      blocks: packetBlocks,
      retryHint,
    });
    const response = await ports.askModel({ cellId: cell.cellId, attempt, ...prompt });
    const answer = response.output;
    const confidenceBp = Math.round(answer.confidencePercent * 100);
    const decision = decisionFromModelAnswer(cell.column, answer, confidenceBp);
    if (!decision) {
      retryHint = "The answer must match the question type exactly and use only the listed keys.";
      continue;
    }

    let fabricated = 0;
    const kept: Array<{ block: CitationBlock; quote: string; support: EvidenceRow["support"] }> =
      [];
    for (const citation of answer.citations) {
      // Nur Blöcke des eigenen Belegpakets: ein Zitat aus einem Block, den die Zelle nie
      // gesehen hat, wäre ein Beleg, den das Modell nicht gelesen haben kann.
      const grounded = groundCitation(citation.exactQuote, packetKeys.get(citation.blockKey));
      if (!grounded) {
        fabricated += 1;
        continue;
      }
      kept.push({ block: grounded.block, quote: grounded.quote, support: citation.support });
    }

    const evidence: EvidenceRow[] = kept.map((entry, index) => ({
      documentBlockId: entry.block.documentBlockId,
      citationOrder: index + 1,
      support: entry.support,
      exactQuote: entry.quote,
      blockTextHash: entry.block.textHash,
      pageNumber: entry.block.pageNumber,
      paragraphNumber: entry.block.paragraphNumber,
    }));

    const verdict: CitationVerdict =
      fabricated > 0
        ? "fabricated"
        : kept.some((entry) => entry.support === "contradicts")
          ? "contradicted"
          : kept.length > 0
            ? "verified"
            : "unsupported";

    // Nummern der Begründung und Belege müssen zusammenpassen. Ist ein Zitat
    // weggefallen, verschöbe sich die Nummerierung — dann gilt die zusammengesetzte Fassung.
    const useModelRationale =
      fabricated === 0 && rationaleMatchesCitations(answer.rationale, kept.length);
    const composed = composeRationale({
      locale: config.locale,
      columnLabel: cell.column.label,
      decision,
      citationNumbers: evidence.map((row) => row.citationOrder),
    });
    const rationale = useModelRationale
      ? kept.length === 0
        ? `${answer.rationale} ${noEvidenceMessage(config.locale)}`
        : answer.rationale
      : composed;

    const needsReview =
      verdict !== "verified" || decision.confidenceBp < config.escalationThresholdBp;
    const settlement: CellSettlement = {
      cellId: cell.cellId,
      state: needsReview ? "needs_review" : "complete",
      source: "escalation_model",
      decision,
      rationale,
      citationVerdict: verdict,
      decisionModelId: response.modelId,
      inputHash: cell.packetInputHash,
      outputHash: createContentHash({ answer: decision.distribution, evidence, verdict }),
      evidence,
    };

    if (fabricated > 0 && attempt === 1) {
      retryHint = "Every quote must be copied verbatim from one of the supplied blocks.";
      lastFabricated = settlement;
      continue;
    }
    return { kind: "settled", settlement };
  }

  return lastFabricated ? { kind: "settled", settlement: lastFabricated } : { kind: "unusable" };
}

/* -------------------------------------------------------------------------- */
/* Modellmodus: dasselbe Raster ohne einen einzigen Jev-Aufruf.                */
/* -------------------------------------------------------------------------- */

export async function decideModelCells(input: {
  cells: readonly DecisionCell[];
  blocksByKey: ReadonlyMap<string, ReviewBlock>;
  config: DecisionConfig;
  ports: DecisionPorts;
  concurrency?: number;
}) {
  await mapWithConcurrency(input.cells, input.concurrency ?? 3, async (cell) => {
    try {
      const result = await askModelForCell(cell, input.blocksByKey, input.config, input.ports);
      if (result.kind === "settled") {
        await input.ports.settle(result.settlement);
        return;
      }
      await input.ports.settle({
        cellId: cell.cellId,
        state: "failed",
        failureCode: "MODEL_OUTPUT_INVALID",
        evidence: [],
      });
    } catch (error) {
      const code = input.ports.isCellLevelFailure(error);
      if (!code) throw error;
      await input.ports.settle({
        cellId: cell.cellId,
        state: "failed",
        failureCode: code,
        evidence: [],
      });
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Jev-Modus: Entscheidung, Zitatprüfung, Eskalation.                          */
/* -------------------------------------------------------------------------- */

export async function decideJevCells(input: {
  cells: readonly DecisionCell[];
  blocksByKey: ReadonlyMap<string, ReviewBlock>;
  config: DecisionConfig;
  ports: DecisionPorts;
  concurrency?: number;
  /** Wählt das Zitat aus einem Block. Nur Tests ersetzen es. */
  excerpt?: (canonicalText: string) => string;
}) {
  const { config, ports } = input;
  const blockTokens = new Map(
    [...input.blocksByKey.values()].map((block) => [
      block.blockKey,
      block.tokenCount && block.tokenCount > 0
        ? block.tokenCount
        : estimateTokenCount(block.canonicalText),
    ]),
  );

  /* 1. Entscheidungen — je Zelle ein eigenes Belegpaket, gebündelt nur bei Überlappung. */
  const cellsById = new Map(input.cells.map((cell) => [cell.cellId, cell]));
  const decisionBatches = planJevBatches({
    phase: "decision",
    units: input.cells.map((cell) => ({
      unitId: cell.cellId,
      blockKeys: cell.candidates.map((candidate) => candidate.blockKey),
      questionTokens: questionTokenCount(decisionQuestion(cell.column)),
    })),
    blockTokens,
    stateTokenBudget: config.stateTokenBudget,
    maxQuestionsPerBatch: 8,
  });

  const decided = new Map<string, JevDecided>();
  const undecided: DecisionCell[] = [];

  await mapWithConcurrency(decisionBatches, input.concurrency ?? 4, async (batch) => {
    const questionKeys = new Map(batch.unitIds.map((unitId, index) => [unitId, `q${index}`]));
    const questions: Record<string, SystemOneQuestion> = {};
    for (const unitId of batch.unitIds) {
      const cell = cellsById.get(unitId)!;
      questions[questionKeys.get(unitId)!] = decisionQuestion(cell.column);
    }
    const stateBlocks = batch.blockKeys.map((key) => input.blocksByKey.get(key)!).filter(Boolean);
    const state =
      batch.blockKeys.length === 0 ? noPassageState : composeState(stateBlocks, batch.blockKeys);
    const answers = await ports.askJev({
      phase: "decision",
      batchKey: batch.batchKey,
      cellId: batch.unitIds.length === 1 ? batch.unitIds[0] : undefined,
      state,
      questions,
      estimatedInputTokens: batch.stateTokens + batch.longestQuestionTokens,
    });

    for (const unitId of batch.unitIds) {
      const cell = cellsById.get(unitId)!;
      const question = questions[questionKeys.get(unitId)!]!;
      const answer = answers[questionKeys.get(unitId)!];
      const decision =
        answer && answerMatchesQuestion(question, answer)
          ? decisionFromAnswer(cell.column, answer)
          : undefined;
      if (!decision) {
        undecided.push(cell);
        continue;
      }
      // Das Zitat wählt der Code — der Anfang der stärksten Blöcke, ein exakter Substring.
      const selected = selectCellEvidence({
        candidates: cell.candidates,
        blocksByKey: input.blocksByKey,
        excerpt: input.excerpt ?? citationExcerpt,
      });
      decided.set(cell.cellId, {
        cell,
        decision,
        rows: selected.map((entry) => {
          const block = input.blocksByKey.get(entry.blockKey)!;
          // Stufe eins: der exakte Substring-Vergleich. Ein Zitat, das den Vergleich nicht
          // besteht, wird ohne jeden Modellaufruf abgewiesen.
          const grounded = groundCitation(entry.quote, block);
          return {
            order: entry.citationOrder,
            block,
            quote: grounded?.quote ?? entry.quote,
            fabricated: grounded === undefined,
          };
        }),
        checks: [],
        inputHash: cell.packetInputHash,
        outputHash: createContentHash({ decision: decision.distribution, answer: answer }),
      });
    }
  });

  /* 2. Zitatprüfung — Stufe zwei, gebündelt über gleiche Zitate. */
  const citationTokens = new Map<string, number>();
  const excerptByBlock = new Map<string, string>();
  const citationUnits: Array<{
    unitId: string;
    entry: JevDecided;
    rowIndex: number;
    blockKey: string;
    question: SystemOneQuestion;
  }> = [];
  for (const entry of decided.values()) {
    entry.rows.forEach((row, rowIndex) => {
      if (row.fabricated) {
        entry.checks[rowIndex] = { verdict: "fabricated", confidenceBp: 0, needsReview: true };
        return;
      }
      excerptByBlock.set(row.block.blockKey, row.quote);
      citationTokens.set(row.block.blockKey, estimateTokenCount(row.quote));
      citationUnits.push({
        unitId: `${entry.cell.cellId}:${row.order}`,
        entry,
        rowIndex,
        blockKey: row.block.blockKey,
        question: citationQuestion(claimFor(entry.cell.column, entry.decision)),
      });
    });
  }
  const citationBatches = planJevBatches({
    phase: "citation",
    units: citationUnits.map((unit) => ({
      unitId: unit.unitId,
      blockKeys: [unit.blockKey],
      questionTokens: questionTokenCount(unit.question),
    })),
    blockTokens: citationTokens,
    stateTokenBudget: config.stateTokenBudget,
    maxQuestionsPerBatch: 16,
  });
  const citationUnitById = new Map(citationUnits.map((unit) => [unit.unitId, unit]));
  await mapWithConcurrency(citationBatches, input.concurrency ?? 4, async (batch: JevBatch) => {
    const keyByUnit = new Map(batch.unitIds.map((unitId, index) => [unitId, `q${index}`]));
    const questions: Record<string, SystemOneQuestion> = {};
    for (const unitId of batch.unitIds) {
      questions[keyByUnit.get(unitId)!] = citationUnitById.get(unitId)!.question;
    }
    const blockKey = batch.blockKeys[0]!;
    const state = composeState(
      [{ blockKey, canonicalText: excerptByBlock.get(blockKey) ?? "" }],
      [blockKey],
    );
    const answers = await ports.askJev({
      phase: "citation",
      batchKey: batch.batchKey,
      state,
      questions,
      estimatedInputTokens: batch.stateTokens + batch.longestQuestionTokens,
    });
    for (const unitId of batch.unitIds) {
      const unit = citationUnitById.get(unitId)!;
      const answer = answers[keyByUnit.get(unitId)!];
      unit.entry.checks[unit.rowIndex] = answer
        ? citationCheckFromAnswer(answer, config.citationAcceptThresholdBp)
        : { verdict: "unsupported", confidenceBp: 0, needsReview: true };
    }
  });

  /* 3. Ergebnis je Zelle: fertig, prüfbedürftig oder Eskalation. */
  async function settleFromJev(entry: JevDecided, forceReview: boolean) {
    const cellChecks = entry.checks;
    // Erfundene Zitate stehen nicht in der Zelle: sie sind kein Beleg. Die übrigen werden
    // neu nummeriert, damit Begründung, Belegliste und Dokument zusammenpassen.
    const usable = entry.rows
      .map((row, index) => ({ row, check: cellChecks[index] }))
      .filter(
        (item): item is { row: (typeof entry.rows)[number]; check: CitationCheck } =>
          Boolean(item.check) && !item.row.fabricated,
      );
    const evidence = usable.map(({ row, check }, index) =>
      evidenceRowOf(row.block, index + 1, row.quote, check.verdict),
    );
    const outcome = cellCitationOutcome(cellChecks, config.citationAcceptThresholdBp);
    const rationale = composeRationale({
      locale: config.locale,
      columnLabel: entry.cell.column.label,
      decision: entry.decision,
      citationNumbers: evidence.map((row) => row.citationOrder),
    });
    const noEvidence = entry.cell.candidates.length === 0;
    const state = forceReview || noEvidence || outcome.needsReview ? "needs_review" : "complete";
    await ports.settle({
      cellId: entry.cell.cellId,
      state,
      source: "jev",
      decision: entry.decision,
      rationale,
      citationVerdict: outcome.verdict,
      decisionModelId: "jev",
      inputHash: entry.inputHash,
      outputHash: entry.outputHash,
      evidence,
    });
  }

  /** Belegt den Platz, fragt das grosse Modell und fällt notfalls auf die Jev-Antwort zurück. */
  async function escalateOrFallBack(entry: JevDecided) {
    // Der Platz wird atomar belegt; das Budget kann zwischen Lesen und Belegen
    // von einer anderen Zelle aufgebraucht worden sein.
    if (!(await ports.reserveEscalation(entry.cell.cellId))) {
      await settleFromJev(entry, true);
      return;
    }
    try {
      const result = await askModelForCell(entry.cell, input.blocksByKey, config, ports);
      if (result.kind === "settled") {
        await ports.settle(result.settlement);
        return;
      }
    } catch (error) {
      if (!ports.isCellLevelFailure(error)) throw error;
    }
    // Das grosse Modell lieferte nichts Verwertbares: die Zelle behält die Jev-Antwort,
    // sichtbar prüfbedürftig.
    await settleFromJev(entry, true);
  }

  await mapWithConcurrency([...decided.values()], input.concurrency ?? 3, async (entry) => {
    const outcome = cellCitationOutcome(entry.checks, config.citationAcceptThresholdBp);
    // Ohne jedes Belegpaket gibt es nichts, was ein grosses Modell lesen könnte.
    if (entry.cell.candidates.length === 0) {
      await settleFromJev(entry, true);
      return;
    }
    if (!outcome.needsReview && entry.decision.confidenceBp >= config.escalationThresholdBp) {
      await settleFromJev(entry, false);
      return;
    }
    if (entry.cell.alreadyEscalated) {
      await escalateOrFallBack(entry);
      return;
    }
    const escalation = decideEscalation({
      confidenceBp: entry.decision.confidenceBp,
      escalationThresholdBp: config.escalationThresholdBp,
      citationNeedsReview: outcome.needsReview,
      escalatedSoFar: await ports.escalationsUsed(),
      escalationBudgetCells: config.escalationBudgetCells,
    });
    const target = cellStateAfterDecision({
      escalation,
      citationNeedsReview: outcome.needsReview,
    });
    if (target !== "escalated") {
      await settleFromJev(entry, target === "needs_review");
      return;
    }

    await escalateOrFallBack(entry);
  });

  /* 4. Antworten, die zur Frage nicht passten. */
  await mapWithConcurrency(undecided, input.concurrency ?? 3, async (cell) => {
    if (cell.candidates.length > 0 && (await ports.reserveEscalation(cell.cellId))) {
      try {
        const result = await askModelForCell(cell, input.blocksByKey, config, ports);
        if (result.kind === "settled") {
          await ports.settle(result.settlement);
          return;
        }
      } catch (error) {
        if (!ports.isCellLevelFailure(error)) throw error;
      }
    }
    await ports.settle({
      cellId: cell.cellId,
      state: "failed",
      failureCode: "JEV_ANSWER_INVALID",
      evidence: [],
    });
  });
}
