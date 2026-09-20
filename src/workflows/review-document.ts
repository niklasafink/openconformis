import { getWorkflowMetadata } from "workflow";
import { getRun } from "workflow/api";

import {
  beginReviewDocument,
  decideReviewCells,
  failReviewDocument,
  finishReviewDocument,
  prepareReviewDocument,
  readParentWorkflowRunId,
} from "@/server/review/execute-review-document";
import { reviewTerminalIfPermanent } from "@/server/review/review-errors";

async function beginDocumentStep(
  reviewRunId: string,
  runDocumentId: string,
  workflowRunId: string,
) {
  "use step";
  return beginReviewDocument({ reviewRunId, runDocumentId, workflowRunId });
}
beginDocumentStep.maxRetries = 3;

async function prepareDocumentStep(reviewRunId: string, runDocumentId: string) {
  "use step";
  try {
    return await prepareReviewDocument({ reviewRunId, runDocumentId });
  } catch (error) {
    reviewTerminalIfPermanent(error);
  }
}
prepareDocumentStep.maxRetries = 3;

async function decideCellsStep(reviewRunId: string, runDocumentId: string, cellIds: string[]) {
  "use step";
  try {
    return await decideReviewCells({ reviewRunId, runDocumentId, cellIds });
  } catch (error) {
    reviewTerminalIfPermanent(error);
  }
}
decideCellsStep.maxRetries = 3;

async function finishDocumentStep(reviewRunId: string, runDocumentId: string) {
  "use step";
  return finishReviewDocument({ reviewRunId, runDocumentId });
}
finishDocumentStep.maxRetries = 3;

async function failDocumentStep(reviewRunId: string, runDocumentId: string, failureCode: string) {
  "use step";
  return failReviewDocument({ reviewRunId, runDocumentId, failureCode });
}
failDocumentStep.maxRetries = 3;

/**
 * Weckt den Eltern-Lauf. `wakeUp()` ist idempotent: ein wiederholter Abschluss schadet
 * nicht. Ein `resumeHook` wäre schlechter — jeder Aufruf legte ein weiteres Ereignis an,
 * ein Step-Retry zählte also doppelt. Schläft der Eltern-Lauf gerade nicht, holt sein
 * 20-Sekunden-Takt es nach.
 */
async function wakeParentStep(reviewRunId: string) {
  "use step";
  const parentRunId = await readParentWorkflowRunId(reviewRunId);
  if (!parentRunId) return { stoppedCount: 0 };
  try {
    return await getRun(parentRunId).wakeUp();
  } catch {
    return { stoppedCount: 0 };
  }
}
wakeParentStep.maxRetries = 1;

export async function reviewDocumentWorkflow(reviewRunId: string, runDocumentId: string) {
  "use workflow";

  try {
    const { workflowRunId } = getWorkflowMetadata();
    const begun = await beginDocumentStep(reviewRunId, runDocumentId, workflowRunId);
    // Ein zweites Kind für denselben Vertrag endet still — kein Fehler, kein Weckruf.
    if (begun.status === "duplicate") return begun;
    if (begun.status === "ended") {
      await wakeParentStep(reviewRunId);
      return begun;
    }

    await prepareDocumentStep(reviewRunId, runDocumentId);
    // Schritte nacheinander, nicht parallel: die Drosselung gilt je Kind, und ein
    // einziger aktiver Schritt hält sie ein.
    for (const cellIds of begun.cellGroups) {
      const result = await decideCellsStep(reviewRunId, runDocumentId, cellIds);
      // Gestoppt: keine weiteren Zellen, nichts als Fehler melden.
      if (result?.status === "skipped") break;
    }
    const finished = await finishDocumentStep(reviewRunId, runDocumentId);
    await wakeParentStep(reviewRunId);
    return finished;
  } catch (error) {
    // Nur ein Code, nie die Meldung: sie könnte Vertragstext oder Schlüssel enthalten.
    const provided = (error as { code?: unknown } | null)?.code;
    const code =
      typeof provided === "string" && /^[A-Z0-9_]{3,80}$/u.test(provided)
        ? provided
        : error instanceof Error
          ? error.name.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80)
          : "UnknownError";
    await failDocumentStep(reviewRunId, runDocumentId, code);
    await wakeParentStep(reviewRunId);
    throw error;
  }
}
