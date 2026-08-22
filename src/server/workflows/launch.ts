import "server-only";

import { start } from "workflow/api";

import { analysisWorkflow } from "@/workflows/analysis";
import { documentIngestionWorkflow } from "@/workflows/document-ingestion";
import { policyOriginalRetentionWorkflow } from "@/workflows/policy-retention";

export async function launchAnalysisWorkflow(analysisId: string) {
  const run = await start(analysisWorkflow, [analysisId]);
  return { runId: run.runId };
}

export async function launchDocumentIngestionWorkflow(policyVersionId: string) {
  const [ingestion, retention] = await Promise.all([
    start(documentIngestionWorkflow, [policyVersionId]),
    start(policyOriginalRetentionWorkflow, [policyVersionId]),
  ]);
  return { runId: ingestion.runId, retentionRunId: retention.runId };
}
