import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { AnalysisRunLive } from "@/components/results/analysis-run-live";
import { AnalysisResultsWorkspace } from "@/components/results/analysis-results-workspace";
import { loadAnalysisResultLabels } from "@/components/results/result-labels";
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

  const [navigation, t, resultLabels, results] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("AnalysisRun"),
    loadAnalysisResultLabels(),
    analysis.status === "completed"
      ? getOwnedAnalysisResultWorkspace({ analysisId, ownerUserId: user.id })
      : undefined,
  ]);
  const sameOrganization = principal?.organizationId === results?.organizationId;

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
          canConfirm={Boolean(principal && sameOrganization && canConfirmAssessment(principal))}
          canOverride={Boolean(principal && sameOrganization && canOverrideAssessment(principal))}
          initialSelectedId={query.requirement}
          frameworkSlug={results.frameworkSlug}
          policyName={results.policyName}
          organizationContext={results.organizationContext}
          items={results.items}
          labels={resultLabels}
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
