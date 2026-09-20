import "server-only";

import { and, asc, eq, inArray, isNull, like, notInArray, or, sql } from "drizzle-orm";

import { createContentHash } from "@/domain/frameworks/content-hash";
import type { ReviewLocale } from "@/domain/review/column";
import { ModelProviderError } from "@/server/ai/structured-model";
import { composeState } from "@/server/ai/system-one-budget";
import { db } from "@/server/db/client";
import {
  reviewCells,
  reviewEvidencePackets,
  reviewModelInvocations,
  reviewRunColumns,
  reviewRunDocuments,
  reviewRuns,
  reviewTables,
} from "@/server/db/schema/reviews";

import { splitIntoSections } from "./document-sections";
import { callSystemOneOnce, createReviewThrottle } from "./jev-client";
import {
  advanceCells,
  closeOpenCells,
  reserveEscalationSlot,
  settledCellStates,
  settleCell,
} from "./review-cells";
import {
  decideJevCells,
  decideModelCells,
  mapWithConcurrency,
  type DecisionCell,
  type DecisionConfig,
  type DecisionPorts,
  type ReviewBlock,
} from "./review-decision";
import {
  applyRoutingAnswers,
  buildEvidencePacket,
  buildRetrievalEvidencePacket,
  planRouting,
  type BlockScore,
} from "./review-evidence";
import { isReviewRunLive, loadReviewBlocks, loadReviewRun, loadRunColumns } from "./review-loaders";
import { requestStructuredForReview, withRoutingKey } from "./review-provider";

/**
 * Das Kind: ein Vertrag, alle Spalten. Jeder Schritt ist wiederholbar, ohne etwas
 * doppelt zu tun oder zu bezahlen:
 *
 * - Zellen, die schon beendet sind, werden übersprungen (`settleCell` zählt nur beim
 *   ersten Mal).
 * - Jev-Aufrufe laufen über `callSystemOneOnce`: ein bereits bezahlter Batch liefert
 *   seine gespeicherten Antworten, statt erneut zu fragen.
 * - Belegpakete sind je Zelle eindeutig (`review_evidence_packets_cell_uidx`).
 */

/** Zellen je Entscheidungsschritt. Klein genug für ein Funktionszeitlimit mit Eskalationen. */
export const cellsPerDecisionStep = 6;

/** Ein Anbieterfehler, der genau diese eine Zelle betrifft und nicht den ganzen Lauf. */
export function cellLevelFailureCode(error: unknown): string | undefined {
  if (!(error instanceof ModelProviderError)) return undefined;
  return (
    [
      "MODEL_OUTPUT_INVALID",
      "PROVIDER_REFUSAL",
      "PROVIDER_OUTPUT_INCOMPLETE",
      "PROVIDER_RESPONSE_INVALID",
    ] as string[]
  ).includes(error.code)
    ? error.code
    : undefined;
}

export type BeginReviewDocumentResult =
  | {
      status: "running";
      engine: "jev" | "model";
      /** Die offenen Zellen in Gruppen je Entscheidungsschritt — nur IDs. */
      cellGroups: string[][];
    }
  /** Ein anderes Kind bearbeitet diesen Vertrag, oder er ist schon fertig: endet still. */
  | { status: "duplicate" }
  | { status: "ended"; runStatus: string };

export async function beginReviewDocument(input: {
  reviewRunId: string;
  runDocumentId: string;
  workflowRunId: string;
}): Promise<BeginReviewDocumentResult> {
  const run = await loadReviewRun(input.reviewRunId);
  if (!isReviewRunLive(run.status)) return { status: "ended", runStatus: run.status };

  // Der zweite Claim. Der Eltern-Lauf hat `child_workflow_run_id` mit einer Vorläufer-
  // Markierung (`claim:…`) belegt, bevor er `start()` rief; das Kind übernimmt sie mit
  // seiner eigenen Lauf-ID. Ein zweites Kind für denselben Vertrag findet dort eine
  // fremde ID und endet still.
  const [claimed] = await db
    .update(reviewRunDocuments)
    .set({
      childWorkflowRunId: input.workflowRunId,
      startedAt: sql`coalesce(${reviewRunDocuments.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reviewRunDocuments.id, input.runDocumentId),
        eq(reviewRunDocuments.reviewRunId, input.reviewRunId),
        isNull(reviewRunDocuments.finishedAt),
        or(
          isNull(reviewRunDocuments.childWorkflowRunId),
          eq(reviewRunDocuments.childWorkflowRunId, input.workflowRunId),
          like(reviewRunDocuments.childWorkflowRunId, "claim:%"),
        ),
      ),
    )
    .returning({ id: reviewRunDocuments.id });
  if (!claimed) return { status: "duplicate" };

  const cells = await db
    .select({ id: reviewCells.id })
    .from(reviewCells)
    .innerJoin(reviewRunColumns, eq(reviewRunColumns.id, reviewCells.runColumnId))
    .where(
      and(
        eq(reviewCells.runDocumentId, input.runDocumentId),
        notInArray(reviewCells.state, [...settledCellStates]),
      ),
    )
    .orderBy(asc(reviewRunColumns.ordinal));
  const cellIds = cells.map((cell) => cell.id);
  const cellGroups: string[][] = [];
  for (let offset = 0; offset < cellIds.length; offset += cellsPerDecisionStep) {
    cellGroups.push(cellIds.slice(offset, offset + cellsPerDecisionStep));
  }
  return { status: "running", engine: run.decisionEngine, cellGroups };
}

async function loadRunDocument(reviewRunId: string, runDocumentId: string) {
  const [document] = await db
    .select()
    .from(reviewRunDocuments)
    .where(
      and(
        eq(reviewRunDocuments.id, runDocumentId),
        eq(reviewRunDocuments.reviewRunId, reviewRunId),
      ),
    )
    .limit(1);
  if (!document) throw new Error("REVIEW_RUN_DOCUMENT_NOT_FOUND");
  return document;
}

async function writePackets(
  reviewRunId: string,
  packets: Array<{
    cellId: string;
    plan: ReturnType<typeof buildEvidencePacket>;
  }>,
) {
  if (packets.length === 0) return;
  await db
    .insert(reviewEvidencePackets)
    .values(
      packets.map(({ cellId, plan }) => ({
        reviewRunId,
        cellId,
        stateTokenCount: plan.stateTokenCount,
        budgetTokenCount: plan.budgetTokenCount,
        emptyReason: plan.emptyReason,
        candidates: plan.candidates,
        inputHash: plan.inputHash,
        outputHash: plan.outputHash,
      })),
    )
    // Ein Wiederanlauf findet das Paket vor und überschreibt es nicht.
    .onConflictDoNothing({ target: reviewEvidencePackets.cellId });
}

type PreparedDocument = { status: "prepared" | "skipped"; cellCount: number };

/**
 * Belegrouting (Jev) oder deterministische Belegsuche (Modellmodus) — beides endet in
 * demselben Ergebnis: ein Belegpaket je Zelle. Danach wechseln die Zellen von
 * „Belege werden gewählt" zu „Wird geprüft".
 */
export async function prepareReviewDocument(input: {
  reviewRunId: string;
  runDocumentId: string;
}): Promise<PreparedDocument> {
  const run = await loadReviewRun(input.reviewRunId);
  if (!isReviewRunLive(run.status)) return { status: "skipped", cellCount: 0 };
  const document = await loadRunDocument(input.reviewRunId, input.runDocumentId);

  const cells = await db
    .select({
      id: reviewCells.id,
      state: reviewCells.state,
      runColumnId: reviewCells.runColumnId,
      packetId: reviewEvidencePackets.id,
    })
    .from(reviewCells)
    .leftJoin(reviewEvidencePackets, eq(reviewEvidencePackets.cellId, reviewCells.id))
    .where(
      and(
        eq(reviewCells.runDocumentId, input.runDocumentId),
        notInArray(reviewCells.state, [...settledCellStates]),
      ),
    );
  const needPacket = cells.filter((cell) => !cell.packetId);
  if (needPacket.length === 0) return { status: "prepared", cellCount: cells.length };

  await advanceCells({
    reviewRunId: run.id,
    runDocumentId: input.runDocumentId,
    from: ["queued"],
    to: "routing",
  });

  const [columns, blocks] = await Promise.all([
    loadRunColumns(run.id),
    loadReviewBlocks(document.policyVersionId),
  ]);
  const columnByRunColumnId = new Map(columns.map((column) => [column.runColumnId, column]));
  const packetBlocks = blocks.map((block) => ({ ...block }));

  if (run.decisionEngine === "model") {
    // Rückweg ohne Jev: kein Routing-Aufruf, kein TypeSafe-Schlüssel.
    const retrievalBlocks = blocks.map((block) => ({
      id: block.documentBlockId,
      blockKey: block.blockKey,
      ordinal: block.ordinal,
      canonicalText: block.canonicalText,
      headingPath: block.headingPath,
      tokenCount: block.tokenCount,
      textHash: block.textHash,
      pageNumber: block.pageNumber,
      paragraphNumber: block.paragraphNumber,
    }));
    await writePackets(
      run.id,
      needPacket.map((cell) => ({
        cellId: cell.id,
        plan: buildRetrievalEvidencePacket({
          column: columnByRunColumnId.get(cell.runColumnId)!.snapshot,
          key: cell.runColumnId,
          blocks: retrievalBlocks,
        }),
      })),
    );
  } else {
    const sections = splitIntoSections(blocks);
    const blockTokens = new Map(
      packetBlocks.map((block) => [
        block.blockKey,
        block.tokenCount && block.tokenCount > 0
          ? block.tokenCount
          : Math.ceil(block.canonicalText.length / 3.5),
      ]),
    );
    const plan = planRouting({
      sections,
      columns: columns.map((column) => ({ ordinal: column.ordinal, column: column.snapshot })),
      blockTokens,
      stateTokenBudget: run.stateTokenBudget,
    });
    const scores = new Map<number, Map<string, BlockScore>>();
    const throttle = createReviewThrottle();
    const blocksByKey = new Map(blocks.map((block) => [block.blockKey, block]));
    await withRoutingKey(run, async (apiKey) => {
      await mapWithConcurrency(plan.batches, 2, async (batch) => {
        const questions = Object.fromEntries(
          batch.unitIds.map((unitId) => [unitId, plan.units.get(unitId)!.question]),
        );
        const outcome = await callSystemOneOnce({
          reviewRunId: run.id,
          runDocumentId: input.runDocumentId,
          phase: "routing",
          batchKey: batch.batchKey,
          apiKey,
          state: composeState(
            batch.blockKeys.map((key) => blocksByKey.get(key)!),
            batch.blockKeys,
          ),
          questions,
          estimatedInputTokens: batch.stateTokens + batch.longestQuestionTokens,
          throttle,
        });
        applyRoutingAnswers({
          batch,
          answers: outcome.answers,
          units: plan.units,
          sections,
          scores,
          columnOrdinals: columns.map((column) => column.ordinal),
        });
      });
    });
    await writePackets(
      run.id,
      needPacket.map((cell) => {
        const column = columnByRunColumnId.get(cell.runColumnId)!;
        return {
          cellId: cell.id,
          plan: buildEvidencePacket({
            column: column.snapshot,
            blocks: packetBlocks,
            scores: scores.get(column.ordinal) ?? new Map(),
            stateTokenBudget: run.stateTokenBudget,
          }),
        };
      }),
    );
  }

  await advanceCells({
    reviewRunId: run.id,
    runDocumentId: input.runDocumentId,
    from: ["routing"],
    to: "deciding",
  });
  return { status: "prepared", cellCount: cells.length };
}

/** Telemetrie eines Aufrufs des grossen Modells. Kein Inhalt, keine Schlüssel. */
async function recordModelInvocation(input: {
  reviewRunId: string;
  runDocumentId: string;
  cellId: string;
  provider: string;
  modelId: string;
  attempt: number;
  status: "succeeded" | "failed";
  inputTokens?: number;
  outputTokens?: number;
  costMicrounits?: number;
  latencyMilliseconds: number;
  errorCode?: string;
}) {
  await db
    .insert(reviewModelInvocations)
    .values({
      reviewRunId: input.reviewRunId,
      runDocumentId: input.runDocumentId,
      cellId: input.cellId,
      phase: "escalation",
      // Kein Ergebnis wird gespeichert, deshalb gibt es hier keine Bezahl-Idempotenz —
      // wohl aber einen eindeutigen Schlüssel je Zelle, Modell und Versuch.
      batchKey: createContentHash({
        phase: "escalation",
        cellId: input.cellId,
        attempt: input.attempt,
        at: Date.now(),
      }),
      provider: input.provider,
      modelId: input.modelId,
      questionCount: 1,
      status: input.status,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costMicrounits: input.costMicrounits,
      latencyMilliseconds: input.latencyMilliseconds,
      errorCode: input.errorCode,
      completedAt: new Date(),
    })
    .onConflictDoNothing();
}

export type DecideReviewCellsInput = {
  reviewRunId: string;
  runDocumentId: string;
  cellIds: string[];
  /** Nur für Tests: ersetzt die Anbieter-Ports. */
  portOverrides?: Partial<DecisionPorts>;
};

export async function decideReviewCells(input: DecideReviewCellsInput) {
  const run = await loadReviewRun(input.reviewRunId);
  if (!isReviewRunLive(run.status)) return { status: "skipped" as const, settled: 0 };
  const document = await loadRunDocument(input.reviewRunId, input.runDocumentId);

  const rows = await db
    .select({
      cellId: reviewCells.id,
      cellState: reviewCells.state,
      column: reviewRunColumns,
      packet: reviewEvidencePackets,
    })
    .from(reviewCells)
    .innerJoin(reviewRunColumns, eq(reviewRunColumns.id, reviewCells.runColumnId))
    .innerJoin(reviewEvidencePackets, eq(reviewEvidencePackets.cellId, reviewCells.id))
    .where(
      and(
        eq(reviewCells.runDocumentId, input.runDocumentId),
        inArray(reviewCells.id, input.cellIds),
        notInArray(reviewCells.state, [...settledCellStates]),
      ),
    )
    .orderBy(asc(reviewRunColumns.ordinal));
  if (rows.length === 0) return { status: "done" as const, settled: 0 };

  const blocks = await loadReviewBlocks(document.policyVersionId);
  const blocksByKey = new Map<string, ReviewBlock>(blocks.map((block) => [block.blockKey, block]));
  const [table] = await db
    .select({ locale: reviewTables.locale })
    .from(reviewTables)
    .where(eq(reviewTables.id, run.reviewTableId))
    .limit(1);
  const locale: ReviewLocale = table?.locale === "en" ? "en" : "de";

  const config: DecisionConfig = {
    locale,
    stateTokenBudget: run.stateTokenBudget,
    escalationThresholdBp: run.escalationThresholdBp,
    citationAcceptThresholdBp: run.citationAcceptThresholdBp,
    escalationBudgetCells: run.escalationBudgetCells,
    modelId: run.providerModelId,
  };
  const cells: DecisionCell[] = rows.map(({ cellId, cellState, column, packet }) => ({
    cellId,
    alreadyEscalated: cellState === "escalated",
    column: {
      label: column.label,
      columnType: column.columnType,
      instructions: column.instructions,
      criteria: column.criteria,
    },
    candidates: packet.candidates,
    emptyReason: packet.emptyReason ?? undefined,
    packetInputHash: packet.inputHash,
  }));

  let settled = 0;
  const basePorts = (apiKey: string | undefined): DecisionPorts => ({
    askJev: async (call) => {
      if (!apiKey) throw new Error("REVIEW_JEV_KEY_MISSING");
      const outcome = await callSystemOneOnce({
        reviewRunId: run.id,
        runDocumentId: input.runDocumentId,
        cellId: call.cellId,
        phase: call.phase,
        batchKey: call.batchKey,
        apiKey,
        state: call.state,
        questions: call.questions,
        estimatedInputTokens: call.estimatedInputTokens,
        throttle,
      });
      return outcome.answers;
    },
    askModel: async (call) => {
      const startedAt = Date.now();
      try {
        const response = await requestStructuredForReview(run, {
          modelId: run.providerModelId,
          system: call.system,
          user: call.user,
          schemaName: call.schemaName,
          jsonSchema: call.jsonSchema,
          outputSchema: call.outputSchema,
        });
        await recordModelInvocation({
          reviewRunId: run.id,
          runDocumentId: input.runDocumentId,
          cellId: call.cellId,
          provider: run.escalationProvider,
          modelId: response.resolvedModelId,
          attempt: call.attempt,
          status: "succeeded",
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          costMicrounits: response.costMicrounits,
          latencyMilliseconds: Date.now() - startedAt,
        });
        return { output: response.output, modelId: response.resolvedModelId };
      } catch (error) {
        await recordModelInvocation({
          reviewRunId: run.id,
          runDocumentId: input.runDocumentId,
          cellId: call.cellId,
          provider: run.escalationProvider,
          modelId: run.providerModelId,
          attempt: call.attempt,
          status: "failed",
          latencyMilliseconds: Date.now() - startedAt,
          errorCode: error instanceof ModelProviderError ? error.code : "UNKNOWN",
        });
        throw error;
      }
    },
    escalationsUsed: async () => {
      const [row] = await db
        .select({ used: reviewRuns.escalatedCellCount })
        .from(reviewRuns)
        .where(eq(reviewRuns.id, run.id))
        .limit(1);
      return row?.used ?? 0;
    },
    reserveEscalation: (cellId) => reserveEscalationSlot(run.id, cellId),
    settle: async (settlement) => {
      const result = await settleCell(run.id, settlement);
      if (result.settled) settled += 1;
    },
    isCellLevelFailure: cellLevelFailureCode,
    ...input.portOverrides,
  });
  const throttle = createReviewThrottle();

  if (run.decisionEngine === "model") {
    // Der Modellmodus fasst den Routing-Schlüssel nie an: `askJev` bleibt ungenutzt.
    await decideModelCells({
      cells,
      blocksByKey,
      config,
      ports: basePorts(undefined),
    });
  } else {
    await withRoutingKey(run, (apiKey) =>
      decideJevCells({ cells, blocksByKey, config, ports: basePorts(apiKey) }),
    );
  }
  return { status: "done" as const, settled };
}

export async function finishReviewDocument(input: { reviewRunId: string; runDocumentId: string }) {
  // Jede Zelle, die hier noch offen ist, hätte längst beendet sein müssen. Sie
  // bleibt nicht als endlos „läuft" stehen, sondern wird sichtbar als gescheitert geführt.
  await closeOpenCells({
    reviewRunId: input.reviewRunId,
    runDocumentId: input.runDocumentId,
    state: "failed",
    failureCode: "CELL_NOT_SETTLED",
  });
  await db
    .update(reviewRunDocuments)
    .set({
      finishedAt: sql`coalesce(${reviewRunDocuments.finishedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(reviewRunDocuments.id, input.runDocumentId));
  return { runDocumentId: input.runDocumentId, status: "finished" as const };
}

export async function failReviewDocument(input: {
  reviewRunId: string;
  runDocumentId: string;
  failureCode: string;
}) {
  // Stufe zwei der Fehlerbehandlung: das Kind scheitert, seine offenen Zellen werden
  // mit einem Sammel-Update beendet. Beendete Zellen bleiben unangetastet.
  await closeOpenCells({
    reviewRunId: input.reviewRunId,
    runDocumentId: input.runDocumentId,
    state: "failed",
    failureCode: input.failureCode,
  });
  await db
    .update(reviewRunDocuments)
    .set({
      finishedAt: sql`coalesce(${reviewRunDocuments.finishedAt}, now())`,
      failureCode: input.failureCode,
      updatedAt: new Date(),
    })
    .where(eq(reviewRunDocuments.id, input.runDocumentId));
  return { runDocumentId: input.runDocumentId, status: "failed" as const };
}

export async function readParentWorkflowRunId(reviewRunId: string) {
  const [run] = await db
    .select({ workflowRunId: reviewRuns.workflowRunId })
    .from(reviewRuns)
    .where(eq(reviewRuns.id, reviewRunId))
    .limit(1);
  return run?.workflowRunId ?? null;
}
