import {
  executeAnalysisScopeItem,
  finalizeAnalysisExecution,
  prepareAnalysisExecution,
} from "@/server/worker/execute-analysis";
import { markAnalysisRetriesExhausted } from "@/server/worker/fail-analysis";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
import { ProviderRouteConfigurationError } from "@/server/ai/provider-routing";
import { ModelProviderError } from "@/server/ai/structured-model";
import { FatalError, getWorkflowMetadata } from "workflow";

/**
 * Ein Anbieterfehler, der beim nächsten Versuch genauso ausfällt — eine gesperrte
 * Route, ein unbekanntes Modell, ein ungültiger Schlüssel —, wird als `FatalError`
 * weitergereicht. Ohne das wiederholte der Workflow ihn dreimal, verbrannte Zeit
 * und meldete am Ende „alle Versuche verbraucht", was die eigentliche Ursache
 * verdeckte.
 */
function terminalIfPermanent(error: unknown): never {
  if (
    error instanceof TemporaryCredentialError ||
    error instanceof ProviderRouteConfigurationError ||
    (error instanceof ModelProviderError && !error.retryable)
  ) {
    throw new FatalError(error.message);
  }
  throw error;
}

async function prepareAnalysisStep(analysisId: string, workflowRunId: string) {
  "use step";
  try {
    return await prepareAnalysisExecution(analysisId, workflowRunId);
  } catch (error) {
    terminalIfPermanent(error);
  }
}
prepareAnalysisStep.maxRetries = 3;

async function analyzeRequirementStep(
  analysisId: string,
  scopeItemId: string,
  index: number,
  total: number,
) {
  "use step";
  try {
    return await executeAnalysisScopeItem({ analysisId, scopeItemId, index, total });
  } catch (error) {
    terminalIfPermanent(error);
  }
}
analyzeRequirementStep.maxRetries = 3;

async function finalizeAnalysisStep(analysisId: string) {
  "use step";
  return finalizeAnalysisExecution(analysisId);
}
finalizeAnalysisStep.maxRetries = 3;

async function failAnalysisStep(analysisId: string, failureDetail?: string) {
  "use step";
  return markAnalysisRetriesExhausted(analysisId, {
    failureCode: failureDetail ? "PROVIDER_REJECTED" : undefined,
    failureDetail,
  });
}
failAnalysisStep.maxRetries = 3;

export async function analysisWorkflow(analysisId: string) {
  "use workflow";

  try {
    const { workflowRunId } = getWorkflowMetadata();
    const prepared = await prepareAnalysisStep(analysisId, workflowRunId);
    if (prepared.status !== "running") return prepared;
    const { scopeItemIds, concurrency } = prepared;
    // Anforderungen sind voneinander unabhängig. Ein fortlaufender Pool startet die
    // nächste, sobald eine fertig ist; feste Blöcke warteten stets auf die
    // langsamste ihres Blocks, bevor der nächste begann.
    let next = 0;
    let failure: { reason: unknown } | undefined;
    let cancelled: Awaited<ReturnType<typeof analyzeRequirementStep>> | undefined;
    const lane = async () => {
      while (next < scopeItemIds.length && !failure && !cancelled) {
        const index = next;
        next += 1;
        try {
          const result = await analyzeRequirementStep(
            analysisId,
            scopeItemIds[index]!,
            index,
            scopeItemIds.length,
          );
          // Gestoppt: keine weiteren Anforderungen bewerten, nichts als Fehler melden.
          if (result.status === "cancelled") cancelled ??= result;
        } catch (reason) {
          failure ??= { reason };
        }
      }
    };
    // Laufende Nachbarn speichern ihr Ergebnis, bevor der Lauf als fehlgeschlagen gilt.
    await Promise.all(
      Array.from({ length: Math.min(concurrency, scopeItemIds.length) }, () => lane()),
    );
    if (failure) throw failure.reason;
    if (cancelled) return cancelled;
    return await finalizeAnalysisStep(analysisId);
  } catch (error) {
    // Die Begründung des Anbieters mitschreiben, damit die Ergebnisseite den
    // Grund nennen kann statt nur „fehlgeschlagen".
    const detail =
      error instanceof Error && error.message ? error.message.slice(0, 700) : undefined;
    await failAnalysisStep(analysisId, detail);
    throw error;
  }
}
