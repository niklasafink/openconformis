import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { AnalysisRunLive } from "@/components/results/analysis-run-live";
import { AnalysisResultsWorkspace } from "@/components/results/analysis-results-workspace";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import {
  getOwnedAnalysisResultWorkspace,
  getOwnedAnalysisStatus,
} from "@/server/analyses/read-analysis";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { requireSessionPrincipal } from "@/server/auth/session-principal";
import { canConfirmAssessment, canOverrideAssessment } from "@/server/analyses/review-analysis";
import { isDatabaseConfigured } from "@/server/db/client";

type AnalysisPageProps = Readonly<{
  params: Promise<{ locale: string; analysisId: string }>;
  searchParams: Promise<{ requirement?: string }>;
}>;

export default async function AnalysisPage({ params, searchParams }: AnalysisPageProps) {
  const [{ locale, analysisId }, query] = await Promise.all([params, searchParams]);
  if (!hasLocale(routing.locales, locale) || !isDatabaseConfigured) notFound();
  setRequestLocale(locale);

  const [user, principal] = await Promise.all([
    requireAuthenticatedSessionUser().catch(() => null),
    requireSessionPrincipal().catch(() => null),
  ]);
  // Eine abgelaufene Sitzung ist kein „nicht gefunden". Der Nutzer soll sich
  // anmelden können und danach wieder hier landen, statt auf einer 404-Seite zu
  // stehen und den Analyse-Link zu verlieren.
  if (!user) {
    redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/analyses/${analysisId}`)}`);
  }

  const analysis = await getOwnedAnalysisStatus({ analysisId, ownerUserId: user.id });
  if (!analysis) notFound();

  const [navigation, t, results] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("AnalysisRun"),
    analysis.status === "completed"
      ? getOwnedAnalysisResultWorkspace({ analysisId, ownerUserId: user.id })
      : Promise.resolve(undefined),
  ]);

  return (
    <ApplicationShell
      activeArea="analysis"
      activeStep="results"
      locale={locale}
      topbar={
        <>
          <strong className="topbar-title">{navigation("results")}</strong>
          <div className="topbar-actions">
            <LanguageMenu locale={locale} pathname={`/analyses/${analysis.id}`} />
          </div>
        </>
      }
    >
      {results ? (
        <AnalysisResultsWorkspace
          analysisId={analysis.id}
          canConfirm={
            principal
              ? principal.organizationId === results.organizationId &&
                canConfirmAssessment(principal)
              : false
          }
          canOverride={
            principal
              ? principal.organizationId === results.organizationId &&
                canOverrideAssessment(principal)
              : false
          }
          initialSelectedId={query.requirement}
          frameworkSlug={results.frameworkSlug}
          policyName={results.policyName}
          organizationContext={results.organizationContext}
          items={results.items}
          labels={{
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
            status: {
              fulfilled: t("results.status.fulfilled"),
              partially_fulfilled: t("results.status.partially_fulfilled"),
              not_fulfilled: t("results.status.not_fulfilled"),
              not_applicable: t("results.status.not_applicable"),
              no_assessment_possible: t("results.status.no_assessment_possible"),
            },
          }}
        />
      ) : (
        <main className="analysis-run-page">
          <AnalysisRunLive
            analysisId={analysis.id}
            frameworkSlug={analysis.frameworkSlug}
            requirementCount={analysis.requirementCount}
            failure={{ code: analysis.failureCode, detail: analysis.failureDetail }}
            createdAtLabel={new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(analysis.createdAt)}
            initialState={{
              status: analysis.status,
              stage: analysis.stage,
              progressPercent: analysis.progressPercent,
            }}
            labels={{
              title: t("title"),
              failureTitle: t("failureTitle"),
              failureUnknown: t("failureUnknown"),
              failureHint: t("failureHint"),
              progressLabel: t("progressLabel"),
              stageLabel: t("stageLabel"),
              requirementsLabel: t("requirementsLabel"),
              startedLabel: t("startedLabel"),
              queuedNote: t("queuedNote"),
              pollingFailed: t("pollingFailed"),
              status: {
                queued: t("status.queued"),
                running: t("status.running"),
                completed: t("status.completed"),
                failed: t("status.failed"),
                cancelled: t("status.cancelled"),
              },
              stage: {
                queued: t("stage.queued"),
                preprocessing: t("stage.preprocessing"),
                retrieval: t("stage.retrieval"),
                assessment: t("stage.assessment"),
                verification: t("stage.verification"),
                finalizing: t("stage.finalizing"),
                completed: t("stage.completed"),
              },
            }}
          />
        </main>
      )}
    </ApplicationShell>
  );
}
