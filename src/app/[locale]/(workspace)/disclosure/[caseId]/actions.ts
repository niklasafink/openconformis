"use server";

import { prepareUploadDraft } from "@/app/[locale]/(workspace)/reviews/[reviewId]/actions";
import { attachDisclosureReport } from "@/server/disclosure/manage-case";

export type DisclosureActionResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

/**
 * Die Upload-Kette ist an einen aktiven Entwurf gebunden. Wie die Vertragsprüfung
 * leiht sich die Offenlegungspflicht dafür den gebundenen Entwurf des Nutzers.
 */
export async function prepareReportDraft(input: {
  locale: string;
}): Promise<DisclosureActionResult<{ draftId: string }>> {
  return prepareUploadDraft(input);
}

/** Übernimmt den fertig aufbereiteten Bericht aus dem Entwurf in die Prüfung. */
export async function attachReport(input: {
  caseId: string;
  policyVersionId: string;
  draftId: string;
}): Promise<DisclosureActionResult<{ caseDocumentId: string }>> {
  return attachDisclosureReport({ ...input, role: "report" });
}

/** Übernimmt den Vorjahresbericht; Gegenstück des Abgleichs mit dem Vorjahr. */
export async function attachPriorReport(input: {
  caseId: string;
  policyVersionId: string;
  draftId: string;
}): Promise<DisclosureActionResult<{ caseDocumentId: string }>> {
  return attachDisclosureReport({ ...input, role: "prior_report" });
}
