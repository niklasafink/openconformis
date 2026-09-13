import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import {
  AnalysisNotificationsButton,
  AnalysisRerunControls,
  AnalysisRunHeaderProvider,
  AnalysisRunHeaderStatus,
} from "@/components/results/analysis-run-header";
import { AnalysisRunLive } from "@/components/results/analysis-run-live";
import { AnalysisResultsWorkspace } from "@/components/results/analysis-results-workspace";
import { RequirementSelectionProvider } from "@/components/results/requirement-selection";
import { loadAnalysisResultLabels } from "@/components/results/result-labels";
import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { getAnalysisModelCatalogue } from "@/server/ai/model-catalogue";
import { listSavedCredentials } from "@/server/ai/saved-credential-service";
import { listActiveTemporaryCredentials } from "@/server/ai/temporary-credential-service";
import {
  getOwnedAnalysisResultWorkspace,
  getOwnedAnalysisStatus,
} from "@/server/analyses/read-analysis";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { requireSessionPrincipal } from "@/server/auth/session-principal";
import { originalDocumentKind } from "@/server/policies/original-document";
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

  const [navigation, t, access, resultLabels, results, credentials, catalogue, savedCredentials] =
    await Promise.all([
      getTranslations("Navigation"),
      getTranslations("AnalysisRun"),
      getTranslations("ResultsPreview"),
      loadAnalysisResultLabels(),
      getOwnedAnalysisResultWorkspace({ analysisId, ownerUserId: user.id }),
      listActiveTemporaryCredentials("analysis").catch(() => []),
      getAnalysisModelCatalogue(),
      listSavedCredentials().catch(() => []),
    ]);
  // Grün, solange der an diesen Lauf gebundene Schlüssel noch hinterlegt ist.
  const boundCredential = credentials.find(
    (credential) => credential.bindingId === analysis.sourceDraftId,
  );
  const sameOrganization = principal?.organizationId === results?.organizationId;
  // Ohne Original — gelöscht nach Aufbewahrungsfrist — bleibt nur der
  // ausgelesene Text; der Umschalter entfällt dann.
  const originalKind = results?.policyOriginalDeletedAt
    ? null
    : originalDocumentKind(results?.policyMimeType ?? null);
  const running = analysis.status !== "completed";

  const createdAtLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(analysis.createdAt);
  const liveLabels = {
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
  };

  const runHeaderLabels = {
    ...liveLabels,
    assessedCount: resultLabels.pending.assessedCount,
    notifications: t("notifications"),
    noNotifications: t("noNotifications"),
    dismiss: t("dismiss"),
    showNotice: t("showNotice"),
    newAnalysis: t("newAnalysis"),
    newAnalysisAll: t("newAnalysisAll"),
    newAnalysisSelection: t("newAnalysisSelection", { count: "{count}" }),
    cancelledNotice: t("cancelledNotice"),
    stop: t("stop"),
    stopping: t("stopping"),
    stopFailed: t("stopFailed"),
  };

  return (
    <RequirementSelectionProvider
      requirementKeys={results?.items.map(({ requirementKey }) => requirementKey) ?? []}
      labels={{
        selectAll: t("selectAll"),
        select: t("selectRequirement", { requirement: "{requirement}" }),
      }}
    >
      <AnalysisRunHeaderProvider
        analysisId={analysis.id}
        failure={{ code: analysis.failureCode, detail: analysis.failureDetail }}
        initialState={{
          status: analysis.status,
          stage: analysis.stage,
          progressPercent: analysis.progressPercent,
        }}
        labels={runHeaderLabels}
      >
        <PageHeader
          title={navigation("results")}
          status={
            running && results ? (
              <AnalysisRunHeaderStatus
                assessed={results.items.filter(({ pending }) => !pending).length}
                total={results.items.length}
              />
            ) : null
          }
          actions={
            <>
              <AnalysisRerunControls
                catalogue={catalogue}
                initialModelProfileId={analysis.modelProfileId}
                lastFour={boundCredential ? (boundCredential.lastFour ?? "") : null}
                locale={locale}
                savedCredentials={savedCredentials}
                labels={{
                  panelTitle: access("panelTitle"),
                  model: access("model"),
                  selected: access("selected"),
                  apiKey: access("apiKey"),
                  savedKey: access("savedKey", { lastFour: "{lastFour}" }),
                  removeSavedKey: access("removeSavedKey"),
                  addKey: access("addKey"),
                  addingKey: access("addingKey"),
                  keyFailed: access("keyFailed"),
                  keyErrors: access.raw("keyErrors") as Record<string, string>,
                  modelFailed: access("modelFailed"),
                  start: access("start"),
                  starting: access("starting"),
                  startFailed: access("startFailed"),
                }}
              />
              <AnalysisNotificationsButton />
              <LanguageMenu locale={locale} pathname={`/analyses/${analysis.id}`} />
            </>
          }
        />
      </AnalysisRunHeaderProvider>
      <div className="workspace-content min-w-0">
        {results ? (
          <AnalysisResultsWorkspace
            analysisId={analysis.id}
            canConfirm={Boolean(principal && sameOrganization && canConfirmAssessment(principal))}
            canOverride={Boolean(principal && sameOrganization && canOverrideAssessment(principal))}
            initialSelectedId={query.requirement}
            policyName={results.policyName}
            organizationContext={results.organizationContext}
            items={results.items}
            labels={resultLabels}
            documentBlocks={results.documentBlocks}
            original={
              originalKind ? { policyVersionId: results.policyVersionId, kind: originalKind } : null
            }
          />
        ) : (
          <main className="analysis-run-page">
            <AnalysisRunLive
              analysisId={analysis.id}
              frameworkSlug={analysis.frameworkSlug}
              requirementCount={analysis.requirementCount}
              failure={{ code: analysis.failureCode, detail: analysis.failureDetail }}
              createdAtLabel={createdAtLabel}
              initialState={{
                status: analysis.status,
                stage: analysis.stage,
                progressPercent: analysis.progressPercent,
              }}
              labels={liveLabels}
            />
          </main>
        )}
      </div>
    </RequirementSelectionProvider>
  );
}
