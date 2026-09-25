import "server-only";

import { and, eq, sql } from "drizzle-orm";

import {
  assignmentAnswerSchema,
  assignmentConfidenceThresholdBp,
  buildAssignmentPrompt,
  planAssignmentBatches,
  readAssignments,
  type AssignmentBatch,
} from "@/domain/disclosure/assignment";
import { modelAssignmentChecks, runDeterministicChecks } from "@/domain/disclosure/checks/run";
import { ModelProviderError } from "@/server/ai/structured-model";
import { db } from "@/server/db/client";
import { disclosureModelInvocations, disclosureRuns } from "@/server/db/schema/disclosure";

import { loadEngineDocument } from "./engine-document";
import { storeChecks } from "./execute-run";
import { requestStructuredForDisclosure } from "./model-route";

/**
 * Einordnung der offenen Fundstellen über das Nutzermodell. Die Batches entstehen bei
 * jedem Schritt neu aus der eingefrorenen Erkennung — dieselben Eingaben ergeben
 * dieselben Batches und Schlüssel. Eine gespeicherte Antwort wird nie ein zweites Mal
 * bezahlt: `(run_id, batch_key)` ist eindeutig und trägt die Antwort.
 */

async function loadRun(runId: string) {
  const [run] = await db.select().from(disclosureRuns).where(eq(disclosureRuns.id, runId)).limit(1);
  if (!run) throw new Error("DISCLOSURE_RUN_NOT_FOUND");
  return run;
}

async function planFor(run: Awaited<ReturnType<typeof loadRun>>) {
  const document = await loadEngineDocument(run.reportCaseDocumentId);
  if (!document) throw new Error("DISCLOSURE_REPORT_MISSING");
  const result = runDeterministicChecks(document);
  const batches =
    run.providerModelId && run.promptVersion
      ? planAssignmentBatches(result.pending, {
          providerModelId: run.providerModelId,
          promptVersion: run.promptVersion,
        })
      : [];
  return { document, result, batches };
}

/** Anzahl der Batches; im Lauf gespeichert, damit Fortschritt und Abschluss sie kennen. */
export async function planDisclosureAssignment(runId: string) {
  const run = await loadRun(runId);
  if (run.status !== "running" || !run.routeProvider) return { batches: 0 };
  const { batches } = await planFor(run);
  await db
    .update(disclosureRuns)
    .set({ assignmentBatchCount: batches.length, stage: "assignment", updatedAt: new Date() })
    .where(eq(disclosureRuns.id, runId));
  return { batches: batches.length };
}

type StoredAnswer = { assignments: unknown };

async function answerFor(run: Awaited<ReturnType<typeof loadRun>>, batch: AssignmentBatch) {
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
export async function assignDisclosureBatch(runId: string, index: number) {
  const run = await loadRun(runId);
  if (run.status !== "running") return { state: "ended" as const, stored: 0 };
  if (run.credentialDeadlineAt && run.credentialDeadlineAt.getTime() < Date.now()) {
    throw new Error("DISCLOSURE_CREDENTIAL_EXPIRED");
  }
  const { document, result, batches } = await planFor(run);
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
