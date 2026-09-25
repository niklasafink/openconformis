import { FatalError, getWorkflowMetadata } from "workflow";

import { completenessConcurrency } from "@/domain/disclosure/completeness";
import { markDisclosureBatchFailed } from "@/server/disclosure/assign-run";
import {
  assessCompletenessItem,
  finalizeCompletenessRun,
  openCompletenessItems,
} from "@/server/disclosure/completeness-run";
import { failDisclosureRun, prepareDisclosureRun } from "@/server/disclosure/execute-run";
import { terminalIfPermanent } from "@/server/disclosure/workflow-errors";

import { codeOf, runEndingCodes } from "./disclosure-errors";

async function prepareStep(runId: string, workflowRunId: string) {
  "use step";
  return prepareDisclosureRun(runId, workflowRunId);
}
prepareStep.maxRetries = 3;

async function itemsStep(runId: string) {
  "use step";
  return openCompletenessItems(runId);
}
itemsStep.maxRetries = 3;

async function assessStep(runId: string, runItemId: string) {
  "use step";
  try {
    return await assessCompletenessItem(runId, runItemId);
  } catch (error) {
    terminalIfPermanent(error);
  }
}
assessStep.maxRetries = 3;

async function itemFailedStep(runId: string) {
  "use step";
  return markDisclosureBatchFailed(runId);
}
itemFailedStep.maxRetries = 3;

async function finalizeStep(runId: string) {
  "use step";
  return finalizeCompletenessRun(runId);
}
finalizeStep.maxRetries = 3;

async function failStep(runId: string, code: string, detail?: string) {
  "use step";
  return failDisclosureRun(runId, { code, detail });
}
failStep.maxRetries = 3;

/**
 * Vollständigkeitsprüfung: Beanspruchen → je Position eine Bewertung in parallelen
 * Blöcken → Abschluss. Argument ist nur die Lauf-ID; Bericht, Checklisten-Schnappschuss,
 * Modellroute und Prompt-Version stehen eingefroren im Lauf. Eine dauerhaft gescheiterte
 * Position ist eine Lücke (`completed_with_gaps`), die anderen bleiben.
 */
export async function disclosureCompletenessWorkflow(runId: string) {
  "use workflow";
  try {
    const { workflowRunId } = getWorkflowMetadata();
    const prepared = await prepareStep(runId, workflowRunId);
    if (prepared.status !== "running") return prepared;
    const items = await itemsStep(runId);
    for (let start = 0; start < items.length; start += completenessConcurrency) {
      const block = items.slice(start, start + completenessConcurrency);
      const settled = await Promise.allSettled(block.map((id) => assessStep(runId, id)));
      // Erst den ganzen Block abwarten, damit gelungene Nachbarn ihr Ergebnis speichern.
      for (const result of settled) {
        if (result.status === "fulfilled") continue;
        if (runEndingCodes.test(codeOf(result.reason))) throw result.reason;
        await itemFailedStep(runId);
      }
      const ended = settled.some(
        (result) => result.status === "fulfilled" && result.value.state === "ended",
      );
      if (ended) return { status: "ended" };
    }
    return await finalizeStep(runId);
  } catch (error) {
    const detail = error instanceof FatalError ? error.message.slice(0, 700) : undefined;
    await failStep(runId, codeOf(error), detail);
    throw error;
  }
}
