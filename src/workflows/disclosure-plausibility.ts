import { FatalError, getWorkflowMetadata } from "workflow";

import {
  assignDisclosureBatch,
  assignDisclosureJevBatch,
  markDisclosureBatchFailed,
  planDisclosureAssignment,
  planDisclosureChunks,
  planDisclosureJev,
  recordDisclosureProgress,
} from "@/server/disclosure/assign-run";
import {
  failDisclosureRun,
  finalizeDisclosureRun,
  prepareDisclosureRun,
  runDeterministicStage,
} from "@/server/disclosure/execute-run";
import { terminalIfPermanent } from "@/server/disclosure/workflow-errors";

import { codeOf, runEndingCodes } from "./disclosure-errors";

async function prepareStep(runId: string, workflowRunId: string) {
  "use step";
  return prepareDisclosureRun(runId, workflowRunId);
}
prepareStep.maxRetries = 3;

async function deterministicStep(runId: string) {
  "use step";
  try {
    return await runDeterministicStage(runId);
  } catch (error) {
    terminalIfPermanent(error);
  }
}
deterministicStep.maxRetries = 3;

async function chunkPlanStep(runId: string) {
  "use step";
  return planDisclosureChunks(runId);
}
chunkPlanStep.maxRetries = 3;

async function jevPlanStep(runId: string, chunk: number) {
  "use step";
  return planDisclosureJev(runId, chunk);
}
jevPlanStep.maxRetries = 3;

/** Jev ist fail-open: ein Ausfall vermerkt den Batch, dessen Fundstellen gehen ans Modell. */
async function jevStep(runId: string, chunk: number, index: number) {
  "use step";
  return assignDisclosureJevBatch(runId, chunk, index);
}
jevStep.maxRetries = 3;

async function planStep(runId: string, chunk: number) {
  "use step";
  return planDisclosureAssignment(runId, chunk);
}
planStep.maxRetries = 3;

async function assignStep(runId: string, chunk: number, index: number) {
  "use step";
  try {
    return await assignDisclosureBatch(runId, chunk, index);
  } catch (error) {
    terminalIfPermanent(error);
  }
}
assignStep.maxRetries = 3;

async function progressStep(runId: string, chunk: number) {
  "use step";
  return recordDisclosureProgress(runId, chunk);
}
progressStep.maxRetries = 3;

async function batchFailedStep(runId: string) {
  "use step";
  return markDisclosureBatchFailed(runId);
}
batchFailedStep.maxRetries = 3;

async function finalizeStep(runId: string) {
  "use step";
  return finalizeDisclosureRun(runId);
}
finalizeStep.maxRetries = 3;

async function failStep(runId: string, code: string, detail?: string) {
  "use step";
  return failDisclosureRun(runId, { code, detail });
}
failStep.maxRetries = 3;

function range(length: number) {
  return Array.from({ length }, (_, index) => index);
}

/**
 * Plausicheck-Lauf: Beanspruchen → deterministische Prüfungen → Einordnung der offenen
 * Fundstellen Abschnitt für Abschnitt von oben nach unten; je Abschnitt zuerst Jev
 * (nur bei eingefrorenem `on`), dann das Nutzermodell für den Rest, jeweils in
 * parallelen Batches → Abschluss. Argument ist nur die Lauf-ID; Bericht, Versionen,
 * Modellroute und Prompt-Version stehen eingefroren im Lauf.
 */
export async function disclosurePlausibilityWorkflow(runId: string) {
  "use workflow";
  try {
    const { workflowRunId } = getWorkflowMetadata();
    const prepared = await prepareStep(runId, workflowRunId);
    if (prepared.status !== "running") return prepared;
    const stage = await deterministicStep(runId);
    if (stage.state !== "running") return stage;
    if (prepared.model && stage.pending > 0) {
      const { chunks } = await chunkPlanStep(runId);
      for (let chunk = 0; chunk < chunks; chunk += 1) {
        if (prepared.jev) {
          // Jev ordnet zuerst ein; erst danach steht fest, was das Nutzermodell bekommt.
          const jev = await jevPlanStep(runId, chunk);
          const settled = await Promise.allSettled(
            range(jev.batches).map((index) => jevStep(runId, chunk, index)),
          );
          const ended = settled.some(
            (result) => result.status === "fulfilled" && result.value.state === "ended",
          );
          if (ended) return { status: "ended" };
        }
        const { batches } = await planStep(runId, chunk);
        const settled = await Promise.allSettled(
          range(batches).map((index) => assignStep(runId, chunk, index)),
        );
        // Erst den ganzen Block abwarten, damit gelungene Nachbarn ihr Ergebnis speichern.
        for (const result of settled) {
          if (result.status === "fulfilled") continue;
          if (runEndingCodes.test(codeOf(result.reason))) throw result.reason;
          await batchFailedStep(runId);
        }
        const ended = settled.some(
          (result) => result.status === "fulfilled" && result.value.state === "ended",
        );
        if (ended) return { status: "ended" };
        await progressStep(runId, chunk);
      }
    }
    return await finalizeStep(runId);
  } catch (error) {
    const detail = error instanceof FatalError ? error.message.slice(0, 700) : undefined;
    await failStep(runId, codeOf(error), detail);
    throw error;
  }
}
