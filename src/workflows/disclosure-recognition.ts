import { getWorkflowMetadata } from "workflow";

import { markRecognitionFailed, recognizeCaseDocument } from "@/server/disclosure/recognize";

async function recognizeStep(caseDocumentId: string, workflowRunId: string) {
  "use step";
  return recognizeCaseDocument(caseDocumentId, workflowRunId);
}
recognizeStep.maxRetries = 3;

async function failRecognitionStep(caseDocumentId: string, code: string) {
  "use step";
  return markRecognitionFailed(caseDocumentId, code);
}
failRecognitionStep.maxRetries = 3;

/**
 * Erkennung eines Prüfungsberichts der Offenlegungspflicht: Zahlen, Richtungswörter
 * und Tabellenstruktur, ohne Modellaufruf. Argument ist nur die Dokument-ID.
 */
export async function disclosureRecognitionWorkflow(caseDocumentId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  try {
    return await recognizeStep(caseDocumentId, workflowRunId);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/u.test(error.message)
        ? error.message
        : "RECOGNITION_FAILED";
    await failRecognitionStep(caseDocumentId, code);
    throw error;
  }
}
