import { markEvidenceFailed, parseEvidenceFile } from "@/server/disclosure/evidence";

async function parseStep(evidenceFileId: string) {
  "use step";
  return parseEvidenceFile(evidenceFileId);
}
parseStep.maxRetries = 3;

async function failStep(evidenceFileId: string, code: string) {
  "use step";
  return markEvidenceFailed(evidenceFileId, code);
}
failStep.maxRetries = 3;

/**
 * Liest eine Belegdatei (SuSa) der Offenlegungspflicht: Konten und Salden, ohne
 * Modellaufruf. Argument ist nur die ID der Belegdatei.
 */
export async function disclosureEvidenceWorkflow(evidenceFileId: string) {
  "use workflow";
  try {
    return await parseStep(evidenceFileId);
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z_]+$/u.test(error.message) ? error.message : "SUSA_FAILED";
    await failStep(evidenceFileId, code);
    throw error;
  }
}
