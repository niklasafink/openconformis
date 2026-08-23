import {
  executeAnalysisScopeItem,
  finalizeAnalysisExecution,
  prepareAnalysisExecution,
} from "@/server/worker/execute-analysis";
import { markAnalysisRetriesExhausted } from "@/server/worker/fail-analysis";
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
  if (error instanceof ModelProviderError && !error.retryable) {
    throw new FatalError(error.message);
  }
  throw error;
}

async function prepareAnalysisStep(analysisId: string, workflowRunId: string) {
  "use step";
  try {
    return await prepareAnalysisExecution(
      { kind: "analysis_execution", analysisId },
      workflowRunId,
    );
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
    if (prepared.status === "completed" || prepared.status === "duplicate") return prepared;
    for (let index = 0; index < prepared.scopeItemIds.length; index += 1) {
      const scopeItemId = prepared.scopeItemIds[index];
      if (!scopeItemId) continue;
      await analyzeRequirementStep(analysisId, scopeItemId, index, prepared.scopeItemIds.length);
    }
    return await finalizeAnalysisStep(analysisId);
  } catch (error) {
    // Die Begründung des Anbieters mitschreiben, damit die Ergebnisseite den
    // Grund nennen kann statt nur „fehlgeschlagen".
    const detail =
      error instanceof Error && error.message ? error.message.slice(0, 300) : undefined;
    await failAnalysisStep(analysisId, detail);
    throw error;
  }
}
