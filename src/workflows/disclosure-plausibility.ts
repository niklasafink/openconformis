import { FatalError, getWorkflowMetadata } from "workflow";

import { assignmentConcurrency } from "@/domain/disclosure/assignment-limits";
import { ProviderRouteConfigurationError } from "@/server/ai/provider-routing";
import { ModelProviderError } from "@/server/ai/structured-model";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
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

/** Fehler, die eine Wiederholung nicht behebt, enden den Schritt sofort mit ihrer Ursache. */
const permanentCodes = new Set([
  "DISCLOSURE_RECOGNITION_CHANGED",
  "DISCLOSURE_REPORT_MISSING",
  "DISCLOSURE_CREDENTIAL_EXPIRED",
]);

/**
 * Ohne gültigen Schlüssel oder Route kann kein weiterer Batch gelingen: dann endet der
 * ganze Lauf mit dem Grund. Eine einzelne unbrauchbare Antwort ist dagegen eine Lücke.
 */
const runEndingCodes =
  /^(?:BYOK_|ANALYSIS_CREDENTIAL_MISSING|DISCLOSURE_CREDENTIAL_EXPIRED|PROVIDER_CREDENTIAL_INVALID|INVALID_PROVIDER_ROUTE|PROVIDER_ROUTE)/u;

function terminalIfPermanent(error: unknown): never {
  if (error instanceof TemporaryCredentialError) throw new FatalError(error.code);
  if (error instanceof ProviderRouteConfigurationError) {
    throw new FatalError("PROVIDER_ROUTE_INVALID");
  }
  if (error instanceof ModelProviderError && !error.retryable) {
    throw new FatalError(`${error.code}: ${error.detail}`.slice(0, 700));
  }
  if (error instanceof Error && permanentCodes.has(error.message)) {
    throw new FatalError(error.message);
  }
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

function codeOf(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0]!.trim();
  return /^[A-Z_]+$/u.test(code) ? code : "DISCLOSURE_RUN_FAILED";
}

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
