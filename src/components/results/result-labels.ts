import { getTranslations } from "next-intl/server";

import type { AnalysisResultLabels } from "./analysis-results-workspace";

/** Beschriftungen des Ergebnisarbeitsplatzes — einmal übersetzt für Vorschau und echten Lauf. */
export async function loadAnalysisResultLabels(): Promise<AnalysisResultLabels> {
  const t = await getTranslations("AnalysisRun");
  return {
    checked: t("results.checked"),
    requirement: t("results.requirement"),
    subrequirements: t("results.subrequirements"),
    organizationContext: t("results.organizationContext"),
    assessment: t("results.assessment"),
    confidence: t("results.confidence"),
    missingInformation: t("results.missingInformation"),
    evidence: t("results.evidence"),
    noEvidence: t("results.noEvidence"),
    page: t("results.page"),
    paragraph: t("results.paragraph"),
    exportExcel: t("results.exportExcel"),
    confirmedCount: t.raw("results.confirmedCount") as string,
    confirmed: t("results.confirmed"),
    confirm: t("results.confirm"),
    confirming: t("results.confirming"),
    confirmationFailed: t("results.confirmationFailed"),
    aiStatus: t("results.aiStatus"),
    manualOverride: t("results.manualOverride"),
    overrideReason: t("results.overrideReason"),
    changeStatus: t("results.changeStatus"),
    statusDialogTitle: t("results.statusDialogTitle"),
    statusDialogReason: t("results.statusDialogReason"),
    statusDialogReasonPlaceholder: t("results.statusDialogReasonPlaceholder"),
    cancel: t("results.cancel"),
    save: t("results.save"),
    saving: t("results.saving"),
    overrideFailed: t("results.overrideFailed"),
    reasonTooShort: t("results.reasonTooShort"),
    policyText: t("results.policyText"),
    documentLoading: t("results.documentLoading"),
    documentFailed: t("results.documentFailed"),
    assessmentPane: t("results.assessmentPane"),
    policyPane: t("results.policyPane"),
    openEvidence: t("results.openEvidence"),
    originalView: t("results.originalView"),
    textView: t("results.textView"),
    originalUnavailable: t("results.originalUnavailable"),
    pending: {
      title: t("results.pending.title"),
      note: t("results.pending.note"),
      noEvidence: t("results.pending.noEvidence"),
      assessedCount: t.raw("results.pending.assessedCount") as string,
    },
    status: {
      fulfilled: t("results.status.fulfilled"),
      partially_fulfilled: t("results.status.partially_fulfilled"),
      not_fulfilled: t("results.status.not_fulfilled"),
      not_applicable: t("results.status.not_applicable"),
      no_assessment_possible: t("results.status.no_assessment_possible"),
    },
  };
}
