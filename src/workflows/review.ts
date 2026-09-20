import { FatalError, getWorkflowMetadata, sleep } from "workflow";
import { start } from "workflow/api";

import {
  claimNextReviewDocuments,
  failReviewExecution,
  finalizeReviewExecution,
  prepareReviewExecution,
  reconcileReviewDocuments,
  recordChildRun,
  releaseChildClaim,
} from "@/server/review/execute-review";

import { reviewDocumentWorkflow } from "./review-document";

async function prepareReviewStep(reviewRunId: string, workflowRunId: string) {
  "use step";
  return prepareReviewExecution(reviewRunId, workflowRunId);
}
prepareReviewStep.maxRetries = 3;

/**
 * Belegt die nächsten Verträge und startet je einen eigenen Kind-Lauf. Die Belegung
 * geschieht **vor** `start()`: ein Wiederholungsversuch dieses Schritts findet die
 * Verträge schon belegt und startet sie nicht ein zweites Mal.
 */
async function startDocumentRunsStep(reviewRunId: string) {
  "use step";
  const claimed = await claimNextReviewDocuments(reviewRunId);
  for (const claim of claimed.claims) {
    try {
      const run = await start(reviewDocumentWorkflow, [reviewRunId, claim.runDocumentId]);
      await recordChildRun(claim, run.runId);
    } catch (error) {
      await releaseChildClaim(claim);
      throw error;
    }
  }
  return { state: claimed.state, started: claimed.claims.length };
}
startDocumentRunsStep.maxRetries = 3;

async function reconcileDocumentsStep(reviewRunId: string) {
  "use step";
  return reconcileReviewDocuments(reviewRunId);
}
reconcileDocumentsStep.maxRetries = 3;

async function finalizeReviewStep(reviewRunId: string) {
  "use step";
  return finalizeReviewExecution(reviewRunId);
}
finalizeReviewStep.maxRetries = 3;

async function failReviewStep(reviewRunId: string, failureDetail?: string) {
  "use step";
  return failReviewExecution(reviewRunId, {
    failureCode: failureDetail ? "PROVIDER_REJECTED" : undefined,
    failureDetail,
  });
}
failReviewStep.maxRetries = 3;

export async function reviewWorkflow(reviewRunId: string) {
  "use workflow";

  try {
    const { workflowRunId } = getWorkflowMetadata();
    const prepared = await prepareReviewStep(reviewRunId, workflowRunId);
    if (prepared.status !== "running") return prepared;

    for (;;) {
      // Höchstens acht Verträge gleichzeitig; ein fertiger macht Platz für den nächsten.
      const started = await startDocumentRunsStep(reviewRunId);
      if (started.state === "ended") break;
      // Dauerhafter Schlaf, verbraucht keine Rechenzeit. Ein Kind weckt den Eltern-Lauf
      // beim Abschluss; der Takt ist zugleich der Wachhund für hart gestorbene Kinder.
      // `sleep()` muss im Workflow stehen, nicht im Step.
      await sleep("20s");
      const state = await reconcileDocumentsStep(reviewRunId);
      if (state.state !== "running") break;
      if (state.open === 0 && state.unstarted === 0) break;
    }
    return await finalizeReviewStep(reviewRunId);
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? error.message.slice(0, 700) : undefined;
    await failReviewStep(reviewRunId, error instanceof FatalError ? detail : undefined);
    throw error;
  }
}
