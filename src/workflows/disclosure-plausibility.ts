import { FatalError, getWorkflowMetadata } from "workflow";

import { assignmentConcurrency } from "@/domain/disclosure/assignment-limits";
import {
  assignDisclosureBatch,
  assignDisclosureJevBatch,
  markDisclosureBatchFailed,
  planDisclosureAssignment,
  planDisclosureJev,
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

async function jevPlanStep(runId: string) {
  "use step";
  return planDisclosureJev(runId);
}
jevPlanStep.maxRetries = 3;

/** Jev ist fail-open: ein Ausfall vermerkt den Batch, dessen Fundstellen gehen ans Modell. */
async function jevStep(runId: string, index: number) {
  "use step";
  return assignDisclosureJevBatch(runId, index);
}
jevStep.maxRetries = 3;

async function planStep(runId: string) {
  "use step";
  return planDisclosureAssignment(runId);
}
planStep.maxRetries = 3;

async function assignStep(runId: string, index: number) {
  "use step";
  try {
    return await assignDisclosureBatch(runId, index);
  } catch (error) {
    terminalIfPermanent(error);
  }
}
assignStep.maxRetries = 3;

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

/**
 * Plausicheck-Lauf: Beanspruchen → deterministische Prüfungen → Einordnung durch Jev
 * (nur bei eingefrorenem `on`) → Einordnung des Rests über das Nutzermodell in
 * parallelen Blöcken → Abschluss. Argument ist nur die Lauf-ID; Bericht,
 * Versionen, Modellroute und Prompt-Version stehen eingefroren im Lauf.
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
      if (prepared.jev) {
        // Jev ordnet zuerst ein; erst danach steht fest, was das Nutzermodell bekommt.
        const jev = await jevPlanStep(runId);
        for (let start = 0; start < jev.batches; start += assignmentConcurrency) {
          const indices = Array.from(
            { length: Math.min(assignmentConcurrency, jev.batches - start) },
            (_, offset) => start + offset,
          );
          const settled = await Promise.allSettled(indices.map((index) => jevStep(runId, index)));
          const ended = settled.some(
            (result) => result.status === "fulfilled" && result.value.state === "ended",
          );
          if (ended) return { status: "ended" };
        }
      }
      const { batches } = await planStep(runId);
      for (let start = 0; start < batches; start += assignmentConcurrency) {
        const indices = Array.from(
          { length: Math.min(assignmentConcurrency, batches - start) },
          (_, offset) => start + offset,
        );
        const settled = await Promise.allSettled(indices.map((index) => assignStep(runId, index)));
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
      }
    }
    return await finalizeStep(runId);
  } catch (error) {
    const detail = error instanceof FatalError ? error.message.slice(0, 700) : undefined;
    await failStep(runId, codeOf(error), detail);
    throw error;
  }
}
