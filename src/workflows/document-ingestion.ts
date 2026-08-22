import {
  beginServerlessPolicyOcr,
  finalizeServerlessPolicyOcr,
  markServerlessPolicyOcrFailed,
  ocrPolicyPageBatch,
} from "@/server/worker/serverless-ocr";
import { ingestPolicyVersion } from "@/server/worker/ingest-policy";
import { getWorkflowMetadata } from "workflow";

async function ingestPolicyStep(policyVersionId: string, workflowRunId: string) {
  "use step";
  return ingestPolicyVersion({ policyVersionId }, workflowRunId);
}
ingestPolicyStep.maxRetries = 3;

async function beginOcrStep(policyVersionId: string) {
  "use step";
  return beginServerlessPolicyOcr(policyVersionId);
}
beginOcrStep.maxRetries = 3;

async function ocrBatchStep(policyVersionId: string, firstPage: number, lastPage: number) {
  "use step";
  return ocrPolicyPageBatch({ policyVersionId, firstPage, lastPage });
}
ocrBatchStep.maxRetries = 2;

async function finalizeOcrStep(policyVersionId: string) {
  "use step";
  return finalizeServerlessPolicyOcr(policyVersionId);
}
finalizeOcrStep.maxRetries = 3;

async function failOcrStep(policyVersionId: string) {
  "use step";
  return markServerlessPolicyOcrFailed(policyVersionId);
}
failOcrStep.maxRetries = 3;

export async function documentIngestionWorkflow(policyVersionId: string) {
  "use workflow";

  try {
    const { workflowRunId } = getWorkflowMetadata();
    const ingestion = await ingestPolicyStep(policyVersionId, workflowRunId);
    if (ingestion.status !== "needs-ocr") return ingestion;

    const ocr = await beginOcrStep(policyVersionId);
    if (ocr.status === "ready") return ocr;
    const batchSize = 4;
    for (let firstPage = 1; firstPage <= ocr.pageCount; firstPage += batchSize) {
      await ocrBatchStep(
        policyVersionId,
        firstPage,
        Math.min(ocr.pageCount, firstPage + batchSize - 1),
      );
    }
    return await finalizeOcrStep(policyVersionId);
  } catch (error) {
    await failOcrStep(policyVersionId);
    throw error;
  }
}
