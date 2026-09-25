import "server-only";

import { start } from "workflow/api";

import { analysisWorkflow } from "@/workflows/analysis";
import { disclosureCompletenessWorkflow } from "@/workflows/disclosure-completeness";
import { disclosureEvidenceWorkflow } from "@/workflows/disclosure-evidence";
import { disclosurePlausibilityWorkflow } from "@/workflows/disclosure-plausibility";
import { disclosureRecognitionWorkflow } from "@/workflows/disclosure-recognition";
import { documentIngestionWorkflow } from "@/workflows/document-ingestion";
import { policyOriginalRetentionWorkflow } from "@/workflows/policy-retention";
import { reviewWorkflow } from "@/workflows/review";

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

/**
 * Startet den Eltern-Lauf einer Vertragsprüfung. Die Kind-Läufe startet dieser selbst:
 * Argumente sind ausschließlich IDs, nie Schlüssel oder Vertragstext.
 */
export async function launchReviewWorkflow(reviewRunId: string) {
  const run = await start(reviewWorkflow, [reviewRunId]);
  return { runId: run.runId };
}

/** Erkennung eines Prüfungsberichts der Offenlegungspflicht; Argument ist nur die ID. */
export async function launchDisclosureRecognitionWorkflow(caseDocumentId: string) {
  const run = await start(disclosureRecognitionWorkflow, [caseDocumentId]);
  return { runId: run.runId };
}

/** Plausicheck-Lauf der Offenlegungspflicht; Argument ist nur die Lauf-ID. */
export async function launchDisclosurePlausibilityWorkflow(runId: string) {
  const run = await start(disclosurePlausibilityWorkflow, [runId]);
  return { runId: run.runId };
}

/** Vollständigkeitsprüfung der Offenlegungspflicht; Argument ist nur die Lauf-ID. */
export async function launchDisclosureCompletenessWorkflow(runId: string) {
  const run = await start(disclosureCompletenessWorkflow, [runId]);
  return { runId: run.runId };
}

/** Lesen einer Belegdatei (SuSa) der Offenlegungspflicht; Argument ist nur ihre ID. */
export async function launchDisclosureEvidenceWorkflow(evidenceFileId: string) {
  const run = await start(disclosureEvidenceWorkflow, [evidenceFileId]);
  return { runId: run.runId };
}
