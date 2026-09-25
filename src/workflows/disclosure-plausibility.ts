import { FatalError, getWorkflowMetadata } from "workflow";

import {
  failDisclosureRun,
  finalizeDisclosureRun,
  prepareDisclosureRun,
  runDeterministicStage,
} from "@/server/disclosure/execute-run";

/** Fehler, die eine Wiederholung nicht behebt, enden den Lauf sofort mit ihrer Ursache. */
const permanentCodes = new Set(["DISCLOSURE_RECOGNITION_CHANGED", "DISCLOSURE_REPORT_MISSING"]);

function terminalIfPermanent(error: unknown): never {
  if (error instanceof Error && permanentCodes.has(error.message))
    throw new FatalError(error.message);
  throw error;
}

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
 * Plausicheck-Lauf: Beanspruchen → deterministische Prüfungen → Abschluss. Argument ist
 * nur die Lauf-ID; Bericht, Versionen und Modellroute stehen eingefroren im Lauf.
 */
export async function disclosurePlausibilityWorkflow(runId: string) {
  "use workflow";
  try {
    const { workflowRunId } = getWorkflowMetadata();
    const prepared = await prepareStep(runId, workflowRunId);
    if (prepared.status !== "running") return prepared;
    const stage = await deterministicStep(runId);
    if (stage.state !== "running") return stage;
    return await finalizeStep(runId);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/u.test(error.message)
        ? error.message
        : "DISCLOSURE_RUN_FAILED";
    const detail = error instanceof FatalError ? error.message.slice(0, 700) : undefined;
    await failStep(runId, code, detail);
    throw error;
  }
}
