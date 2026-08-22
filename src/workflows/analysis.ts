import {
  executeAnalysisScopeItem,
  finalizeAnalysisExecution,
  prepareAnalysisExecution,
} from "@/server/worker/execute-analysis";
import { markAnalysisRetriesExhausted } from "@/server/worker/fail-analysis";
import { getWorkflowMetadata } from "workflow";

async function prepareAnalysisStep(analysisId: string, workflowRunId: string) {
  "use step";
  return prepareAnalysisExecution({ kind: "analysis_execution", analysisId }, workflowRunId);
}
prepareAnalysisStep.maxRetries = 3;

async function analyzeRequirementStep(
  analysisId: string,
  scopeItemId: string,
  index: number,
  total: number,
) {
  "use step";
  return executeAnalysisScopeItem({ analysisId, scopeItemId, index, total });
}
analyzeRequirementStep.maxRetries = 3;

async function finalizeAnalysisStep(analysisId: string) {
  "use step";
  return finalizeAnalysisExecution(analysisId);
}
finalizeAnalysisStep.maxRetries = 3;

async function failAnalysisStep(analysisId: string) {
  "use step";
  return markAnalysisRetriesExhausted(analysisId);
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
    await failAnalysisStep(analysisId);
    throw error;
  }
}
