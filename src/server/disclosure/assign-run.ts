import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { systemOneCostMicrounits } from "@/domain/ai/system-one";
import {
  assignmentAnswerSchema,
  assignmentChunk,
  assignmentChunkCount,
  assignmentConfidenceThresholdBp,
  buildAssignmentPrompt,
  planAssignmentBatches,
  readAssignments,
  settledFigureCount,
  type AssignmentAnswer,
  type AssignmentBatch,
} from "@/domain/disclosure/assignment";
import { modelAssignmentChecks, runDeterministicChecks } from "@/domain/disclosure/checks/run";
import type { EngineDocument } from "@/domain/disclosure/checks/types";
import {
  disclosureJevPromptVersionFor,
  jevAnswerFor as jevAnswerForBatch,
  jevConfidenceThresholdBp,
  jevResolvedFigureIds,
} from "@/domain/disclosure/jev-assignment";
import { ModelProviderError } from "@/server/ai/structured-model";
import { db } from "@/server/db/client";
import { disclosureModelInvocations, disclosureRuns } from "@/server/db/schema/disclosure";

import { loadEngineDocument } from "./engine-document";
import { storeChecks } from "./execute-run";
import {
  disclosureJevActive,
  disclosureJevViaRouter,
  requestJevForBatch,
  requestJevRouterForBatch,
} from "./jev-route";
import { requestStructuredForDisclosure } from "./model-route";

/**
 * Einordnung der offenen Fundstellen über Jev und das Nutzermodell, Abschnitt für
 * Abschnitt von oben nach unten. Die Batches entstehen bei jedem Schritt neu aus der
 * eingefrorenen Erkennung — dieselben Eingaben ergeben
 * dieselben Batches und Schlüssel. Eine gespeicherte Antwort wird nie ein zweites Mal
 * bezahlt: `(run_id, batch_key)` ist eindeutig und trägt die Antwort.
 */

async function loadRun(runId: string) {
  const [run] = await db.select().from(disclosureRuns).where(eq(disclosureRuns.id, runId)).limit(1);
  if (!run) throw new Error("DISCLOSURE_RUN_NOT_FOUND");
  return run;
}

type Run = Awaited<ReturnType<typeof loadRun>>;

/** Jev-Batches aus denselben offenen Fundstellen; bei `off` gibt es keine. */
function jevBatchesFor(run: Run, pending: Parameters<typeof planAssignmentBatches>[0]) {
  if (!disclosureJevActive(run) || !run.jevModelId) return [];
  return planAssignmentBatches(pending, {
    providerModelId: run.jevModelId,
    promptVersion: disclosureJevPromptVersionFor(run.jevModelId),
  });
}

/**
 * Gespeicherte Jev-Antworten je Batch-Schlüssel. Ein gescheiterter Batch hat keine
 * Antwort; seine Fundstellen gehen an das Nutzermodell.
 */
async function storedJevAnswers(runId: string) {
  const rows = await db
    .select({
      batchKey: disclosureModelInvocations.batchKey,
      status: disclosureModelInvocations.status,
      response: disclosureModelInvocations.response,
    })
    .from(disclosureModelInvocations)
    .where(
      and(
        eq(disclosureModelInvocations.runId, runId),
        eq(disclosureModelInvocations.provider, "jev"),
      ),
    );
  const answers = new Map<string, AssignmentAnswer>();
  for (const row of rows) {
    if (row.status !== "succeeded") continue;
    const parsed = assignmentAnswerSchema.safeParse(row.response);
    if (parsed.success) answers.set(row.batchKey, parsed.data);
  }
  return answers;
}

/** Die Regelprüfungen je geladenem Dokument; jeder Schritt braucht nur ihre offenen Fundstellen. */
const deterministic = new WeakMap<EngineDocument, ReturnType<typeof runDeterministicChecks>>();

async function checkedDocument(run: Run) {
  const document = await loadEngineDocument(run.reportCaseDocumentId);
  if (!document) throw new Error("DISCLOSURE_REPORT_MISSING");
  let result = deterministic.get(document);
  if (!result) {
    result = runDeterministicChecks(document);
    deterministic.set(document, result);
  }
  return { document, result };
}

/**
 * Die Batches eines Abschnitts. Das Nutzermodell bekommt nur, was Jev in diesem
 * Abschnitt nicht sicher eingeordnet hat; dieselben gespeicherten Jev-Antworten ergeben
 * dieselben Batches.
 */
async function planFor(run: Run, chunk: number, stage: "jev" | "model" = "model") {
  const { document, result } = await checkedDocument(run);
  const mentions = assignmentChunk(result.pending, chunk);
  const jevBatches = jevBatchesFor(run, mentions);
  if (stage === "jev") return { document, result, batches: jevBatches, resolved: new Set<string>() };
  const resolved = new Set<string>();
  if (jevBatches.length > 0) {
    const answers = await storedJevAnswers(run.id);
    for (const batch of jevBatches) {
      const answer = answers.get(batch.key);
      if (answer) for (const id of jevResolvedFigureIds(batch, answer)) resolved.add(id);
    }
  }
  const batches =
    run.providerModelId && run.promptVersion
      ? planAssignmentBatches(
          mentions.filter((mention) => !resolved.has(mention.figureId)),
          { providerModelId: run.providerModelId, promptVersion: run.promptVersion },
        )
      : [];
  return { document, result, batches, resolved };
}

/**
 * Anzahl der Abschnitte. Sie laufen von oben nach unten nacheinander, damit die ersten
 * Einordnungen früh erscheinen und der Fortschritt dem Dokument folgt.
 */
export async function planDisclosureChunks(runId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running" || !run.routeProvider) return { chunks: 0 };
  const { result } = await checkedDocument(run);
  return { chunks: assignmentChunkCount(result.pending.length) };
}

/** Jev-Batches eines Abschnitts; vor dessen Modell-Batches, weil diese von Jev abhängen. */
export async function planDisclosureJev(runId: string, chunk: number) {
  const run = await loadRun(runId);
  if (run.status !== "running" || !disclosureJevActive(run)) return { batches: 0 };
  const { batches } = await planFor(run, chunk, "jev");
  if (run.stage !== "jev") {
    await db
      .update(disclosureRuns)
      .set({ stage: "jev", updatedAt: new Date() })
      .where(eq(disclosureRuns.id, runId));
  }
  return { batches: batches.length };
}

/** Modell-Batches eines Abschnitts. */
export async function planDisclosureAssignment(runId: string, chunk: number) {
  const run = await loadRun(runId);
  if (run.status !== "running" || !run.routeProvider) return { batches: 0 };
  const { batches } = await planFor(run, chunk);
  await db
    .update(disclosureRuns)
    .set({ stage: "assignment", updatedAt: new Date() })
    .where(eq(disclosureRuns.id, runId));
  return { batches: batches.length };
}

/**
 * Offene Fundstellen, die schon eingeordnet sind: sicher durch Jev oder in einem
 * beantworteten Modell-Batch. Gescheiterte Batches zählen erst im Abschluss.
 */
async function settledFigureIds(run: Run) {
  const { document, result } = await checkedDocument(run);
  const settled = new Set<string>();
  const chunks = assignmentChunkCount(result.pending.length);
  if (chunks === 0) return { document, result, settled };
  const answered = await db
    .select({ batchKey: disclosureModelInvocations.batchKey })
    .from(disclosureModelInvocations)
    .where(
      and(
        eq(disclosureModelInvocations.runId, run.id),
        eq(disclosureModelInvocations.provider, "model"),
        eq(disclosureModelInvocations.status, "succeeded"),
      ),
    );
  const answeredKeys = new Set(answered.map((row) => row.batchKey));
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const { batches, resolved } = await planFor(run, chunk);
    for (const id of resolved) settled.add(id);
    for (const batch of batches) {
      if (!answeredKeys.has(batch.key)) continue;
      for (const item of batch.items) settled.add(item.figureId);
    }
  }
  return { document, result, settled };
}

/**
 * Fortschritt nach jedem gespeicherten Batch: fertig geprüft sind alle Zahlen ohne
 * offene Fundstelle und die schon eingeordneten. Parallele Batches schreiben nur nach
 * oben; ein gestoppter Lauf bleibt stehen.
 */
async function recordProgress(run: Run) {
  const { document, result, settled } = await settledFigureIds(run);
  const checked = settledFigureCount(document, result.pending, settled);
  await db
    .update(disclosureRuns)
    .set({
      checkedFigureCount: sql`greatest(coalesce(${disclosureRuns.checkedFigureCount}, 0), ${checked})`,
      updatedAt: new Date(),
    })
    .where(and(eq(disclosureRuns.id, run.id), eq(disclosureRuns.status, "running")));
}

/** Nach einem Abschnitt: Sicherheitsnetz, falls ein Batch seinen Fortschritt nicht schrieb. */
export async function recordDisclosureProgress(runId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running") return;
  await recordProgress(run);
}

/**
 * Jevs Antwort auf einen Batch, aus dem Replay oder frisch. Scheitert Jev, wird das
 * einmal vermerkt und nie wiederholt: die Fundstellen gehen an das Nutzermodell, und
 * kein Batch wird doppelt bezahlt.
 */
async function storedOrFreshJevAnswer(run: Run, batch: AssignmentBatch) {
  const where = and(
    eq(disclosureModelInvocations.runId, run.id),
    eq(disclosureModelInvocations.batchKey, batch.key),
  );
  const [existing] = await db.select().from(disclosureModelInvocations).where(where).limit(1);
  if (existing?.status === "succeeded") {
    const parsed = assignmentAnswerSchema.safeParse(existing.response);
    return parsed.success ? parsed.data : null;
  }
  if (existing?.status === "failed") return null;
  if (!existing) {
    await db
      .insert(disclosureModelInvocations)
      .values({
        runId: run.id,
        batchKey: batch.key,
        provider: "jev",
        routeProvider: disclosureJevViaRouter(run) ? "openrouter" : "typesafe",
        modelId: run.jevModelId!,
        itemCount: batch.items.length,
      })
      .onConflictDoNothing({
        target: [disclosureModelInvocations.runId, disclosureModelInvocations.batchKey],
      });
  }
  const started = Date.now();
  try {
    if (disclosureJevViaRouter(run)) {
      // Der Jev Router antwortet schon im Schema des Modells (D-036).
      const routed = await requestJevRouterForBatch(run, batch);
      await db
        .update(disclosureModelInvocations)
        .set({
          status: "succeeded",
          response: routed.answer,
          inputTokens: routed.inputTokens,
          outputTokens: routed.outputTokens,
          costMicrounits: routed.costMicrounits,
          latencyMilliseconds: Date.now() - started,
          errorCode: null,
          completedAt: new Date(),
        })
        .where(where);
      return routed.answer;
    }
    const response = await requestJevForBatch(run, batch);
    // Gespeichert wird dasselbe Schema wie beim Modell: nur Kurzzeichen und Konfidenzen.
    const answer = jevAnswerForBatch(batch, response.answers);
    await db
      .update(disclosureModelInvocations)
      .set({
        status: "succeeded",
        response: answer,
        inputTokens: response.inputTokens || null,
        outputTokens: response.outputTokens || null,
        costMicrounits: systemOneCostMicrounits(response.inputTokens) ?? null,
        latencyMilliseconds: Date.now() - started,
        errorCode: response.failedItems > 0 ? response.lastErrorCode : null,
        completedAt: new Date(),
      })
      .where(where);
    return answer;
  } catch (error) {
    await db
      .update(disclosureModelInvocations)
      .set({
        status: "failed",
        errorCode: error instanceof ModelProviderError ? error.code : "PROVIDER_REQUEST_FAILED",
        latencyMilliseconds: Date.now() - started,
        completedAt: new Date(),
      })
      .where(where);
    return null;
  }
}

/**
 * Ein Jev-Batch: nur sichere Zuordnungen werden nachgerechnet und als Prüfungen mit
 * Herkunft `jev` gespeichert. Der Rest bleibt offen für das Nutzermodell.
 */
export async function assignDisclosureJevBatch(runId: string, chunk: number, index: number) {
  const run = await loadRun(runId);
  if (run.status !== "running") return { state: "ended" as const, stored: 0 };
  const { document, result, batches } = await planFor(run, chunk, "jev");
  const batch = batches[index];
  if (!batch) return { state: "running" as const, stored: 0 };
  const answer = await storedOrFreshJevAnswer(run, batch);
  if (!answer) return { state: "running" as const, stored: 0 };
  const confident = answer.assignments.filter(
    (entry) => entry.confidencePercent * 100 >= jevConfidenceThresholdBp,
  );
  const assignments = readAssignments(batch, { assignments: confident }).map((assignment) => ({
    ...assignment,
    candidateCount:
      batch.items.find((item) => item.figureId === assignment.figureId)?.candidates.length ?? 1,
  }));
  const drafts = modelAssignmentChecks(
    document,
    result.resolver,
    assignments,
    jevConfidenceThresholdBp,
    "jev",
  );
  const stored = await storeChecks(runId, drafts);
  await recordProgress(run);
  return { state: "running" as const, stored };
}

type StoredAnswer = { assignments: unknown };

async function answerFor(run: Run, batch: AssignmentBatch) {
  const [existing] = await db
    .select()
    .from(disclosureModelInvocations)
    .where(
      and(
        eq(disclosureModelInvocations.runId, run.id),
        eq(disclosureModelInvocations.batchKey, batch.key),
      ),
    )
    .limit(1);
  if (existing?.status === "succeeded" && existing.response) {
    return assignmentAnswerSchema.parse(existing.response as StoredAnswer);
  }
  if (!existing) {
    await db
      .insert(disclosureModelInvocations)
      .values({
        runId: run.id,
        batchKey: batch.key,
        provider: "model",
        routeProvider: run.routeProvider!,
        modelId: run.providerModelId!,
        itemCount: batch.items.length,
      })
      .onConflictDoNothing({
        target: [disclosureModelInvocations.runId, disclosureModelInvocations.batchKey],
      });
  }
  const started = Date.now();
  try {
    const response = await requestStructuredForDisclosure(run, buildAssignmentPrompt(batch));
    await db
      .update(disclosureModelInvocations)
      .set({
        status: "succeeded",
        response: response.output,
        inputTokens: response.inputTokens ?? null,
        outputTokens: response.outputTokens ?? null,
        costMicrounits: response.costMicrounits ?? null,
        latencyMilliseconds: Date.now() - started,
        errorCode: null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(disclosureModelInvocations.runId, run.id),
          eq(disclosureModelInvocations.batchKey, batch.key),
        ),
      );
    return response.output;
  } catch (error) {
    const usage = error instanceof ModelProviderError ? error.usage : undefined;
    await db
      .update(disclosureModelInvocations)
      .set({
        status: "failed",
        errorCode: error instanceof ModelProviderError ? error.code : "PROVIDER_REQUEST_FAILED",
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        costMicrounits: usage?.costMicrounits ?? null,
        latencyMilliseconds: Date.now() - started,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(disclosureModelInvocations.runId, run.id),
          eq(disclosureModelInvocations.batchKey, batch.key),
        ),
      );
    throw error;
  }
}

/**
 * Ein Batch: Antwort holen (oder aus dem Replay lesen), Zuordnungen nachrechnen und als
 * Prüfungen speichern. Ein gestoppter oder beendeter Lauf ruft kein Modell mehr auf.
 */
export async function assignDisclosureBatch(runId: string, chunk: number, index: number) {
  const run = await loadRun(runId);
  if (run.status !== "running") return { state: "ended" as const, stored: 0 };
  if (run.credentialDeadlineAt && run.credentialDeadlineAt.getTime() < Date.now()) {
    throw new Error("DISCLOSURE_CREDENTIAL_EXPIRED");
  }
  const { document, result, batches } = await planFor(run, chunk);
  const batch = batches[index];
  if (!batch) return { state: "running" as const, stored: 0 };
  const answer = await answerFor(run, batch);
  const assignments = readAssignments(batch, answer).map((assignment) => ({
    ...assignment,
    candidateCount:
      batch.items.find((item) => item.figureId === assignment.figureId)?.candidates.length ?? 1,
  }));
  const drafts = modelAssignmentChecks(
    document,
    result.resolver,
    assignments,
    assignmentConfidenceThresholdBp,
  );
  const stored = await storeChecks(runId, drafts);
  await recordProgress(run);
  return { state: "running" as const, stored };
}

/** Ein Batch ist dauerhaft gescheitert: der Lauf endet mit Lücken, die anderen bleiben. */
export async function markDisclosureBatchFailed(runId: string) {
  await db
    .update(disclosureRuns)
    .set({
      failedBatchCount: sql`${disclosureRuns.failedBatchCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(disclosureRuns.id, runId));
}
