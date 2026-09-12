import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import {
  AnalysisResultsWorkspace,
  type DocumentBlock,
  type ResultItem,
} from "@/components/results/analysis-results-workspace";
import { ModelAccessPanel, type ActiveCredential } from "@/components/results/model-access-panel";
import { loadAnalysisResultLabels } from "@/components/results/result-labels";
import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import { doraDemoRelease } from "@/domain/frameworks/dora-demo-release";
import { routing } from "@/i18n/routing";
import { getAnalysisModelCatalogue } from "@/server/ai/model-catalogue";
import { listActiveTemporaryCredentials } from "@/server/ai/temporary-credential-service";
import { findOwnedAnalysisIdForDraft } from "@/server/analyses/read-analysis";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { getDraftScopeSelection } from "@/server/drafts/scope-selection";
import { originalDocumentKind } from "@/server/policies/original-document";
import { getCurrentPolicyPreview } from "@/server/policies/sample-service";

import { selectAnalysisModel } from "./actions";

type ResultsPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string; auth_error?: string }>;
}>;

export default async function ResultsPage({ params, searchParams }: ResultsPageProps) {
  const { locale } = await params;
  const { draft, auth_error: authCallbackError } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const user = await requireAuthenticatedSessionUser().catch(() => null);

  // Der Claim setzt den Draft auf `claimed`; danach findet ihn getBoundActiveDraft
  // nicht mehr. Wer angemeldet ist und bereits eine Analyse zu diesem Draft
  // besitzt, gehört auf deren Seite — nicht in einen 404 bei Reload oder beim
  // zweiten Klick auf den Anmeldelink.
  if (user && draft) {
    const startedAnalysisId = await findOwnedAnalysisIdForDraft({
      draftId: draft,
      ownerUserId: user.id,
    });
    if (startedAnalysisId) redirect(`/${locale}/analyses/${startedAnalysisId}`);
  }

  const [navigation, t, resultLabels, boundDraft, scope, policyPreview] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("ResultsPreview"),
    loadAnalysisResultLabels(),
    getBoundActiveDraft(draft),
    getDraftScopeSelection(draft),
    getCurrentPolicyPreview(draft),
  ]);

  if (!boundDraft || !scope?.modelSelection || !policyPreview) {
    // Ohne Draft-Bindung lässt sich der Schritt nicht rekonstruieren — der
    // Bindungs-Cookie ist der Eigentumsnachweis am Draft. Angemeldete Nutzer
    // beginnen neu, nicht angemeldete gehen auf die Anmeldefläche, die ohne
    // Cookie funktioniert und den Fehler erklären kann.
    redirect(
      user
        ? `/${locale}/analyses/new/framework`
        : `/${locale}/sign-in${authCallbackError ? `?auth_error=${encodeURIComponent(authCallbackError)}` : ""}`,
    );
  }

  const [catalogue, credentials] = await Promise.all([
    getAnalysisModelCatalogue(),
    listActiveTemporaryCredentials("analysis").catch(() => []),
  ]);
  // Nur ein Schlüssel, der an genau diesen Draft gebunden ist, zählt als Zugang.
  const bound = credentials.find((credential) => credential.bindingId === boundDraft.id);
  const initialCredential: ActiveCredential | null = bound
    ? {
        credentialId: bound.credentialId,
        lastFour: bound.lastFour ?? "",
        accessibleModelIds: bound.accessibleModelIds ?? [],
      }
    : null;

  // Die Originalansicht zeigt die hochgeladene Datei selbst; fehlt sie, bleibt
  // der ausgelesene Text.
  const originalKind = policyPreview.selection.originalDeletedAt
    ? null
    : originalDocumentKind(policyPreview.selection.mimeType ?? null);

  const includedKeys = new Set(scope.includedRequirementKeys);
  // Vor dem Lauf steht jede Anforderung auf „noch nicht bewertet". Es gibt hier
  // bewusst keine geschätzte Ampel: erst der echte Lauf erzeugt Status,
  // Begründung und Belegstellen.
  const items: ResultItem[] = doraDemoRelease.requirements
    .filter((requirement) => includedKeys.has(requirement.externalKey))
    .map((requirement) => ({
      id: `preview-${requirement.externalKey}`,
      regulatoryId: requirement.regulatoryId,
      title: requirement.title,
      legalText: requirement.legalText,
      subrequirements: requirement.subrequirements.map((subrequirement) => ({
        externalKey: subrequirement.externalKey,
        regulatoryId: subrequirement.regulatoryId,
        title: subrequirement.title,
        legalText: subrequirement.legalText,
      })),
      aiStatus: "no_assessment_possible",
      status: "no_assessment_possible",
      override: null,
      explanation: "",
      missingInformation: [],
      confidencePercent: 0,
      verificationStatus: "pending",
      confirmedAt: null,
      evidence: [],
      pending: true,
    }));
  const documentBlocks: DocumentBlock[] = policyPreview.blocks.map(
    ({
      id,
      blockKey,
      ordinal,
      blockType,
      canonicalText,
      headingPath,
      pageNumber,
      paragraphNumber,
    }) => ({
      id,
      blockKey,
      ordinal,
      blockType,
      canonicalText,
      headingPath,
      pageNumber,
      paragraphNumber,
    }),
  );

  return (
    <>
      <PageHeader
        title={navigation("results")}
        eyebrow={t("step")}
        actions={
          <>
            <ModelAccessPanel
              catalogue={catalogue}
              draftId={boundDraft.id}
              initialCredential={initialCredential}
              initialModelProfileId={scope.modelSelection.modelProfileId}
              locale={locale}
              selectModelAction={selectAnalysisModel}
              labels={{
                panelTitle: t("panelTitle"),
                model: t("model"),
                evaluated: t("evaluated"),
                unevaluated: t("unevaluated"),
                unevaluatedWarning: t("unevaluatedWarning"),
                apiKey: t("apiKey"),
                keyLink: t("keyLink"),
                connect: t("connect"),
                connecting: t("connecting"),
                connected: t("connected"),
                notConnected: t("notConnected"),
                unreachable: t("unreachable"),
                keyFailed: t("keyFailed"),
                modelFailed: t("modelFailed"),
                start: t("start"),
                starting: t("starting"),
                startFailed: t("startFailed"),
                replaceKey: t("replaceKey"),
                hint: t("hint"),
              }}
            />
            <LanguageMenu locale={locale} pathname="/analyses/new/results" />
          </>
        }
      />
      <div className="workspace-content min-w-0">
        <AnalysisResultsWorkspace
          analysisId="preview"
          canConfirm={false}
          canOverride={false}
          frameworkSlug={boundDraft.frameworkSlug ?? "dora"}
          policyName={policyPreview.selection.filename}
          organizationContext={scope.organizationContext}
          items={items}
          labels={resultLabels}
          documentBlocks={documentBlocks}
          original={
            originalKind && policyPreview.selection.policyVersionId
              ? {
                  policyVersionId: policyPreview.selection.policyVersionId,
                  kind: originalKind,
                  draftId: boundDraft.id,
                }
              : null
          }
        />
      </div>
    </>
  );
}
