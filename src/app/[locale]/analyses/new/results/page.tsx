import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { PreviewGate } from "@/components/results/preview-gate";
import type { ResultItem, ResultStatus } from "@/components/results/analysis-results-workspace";
import { loadAnalysisResultLabels } from "@/components/results/result-labels";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { aiProviderPublicDetails } from "@/domain/ai/provider";
import { doraDemoRelease } from "@/domain/frameworks/dora-demo-release";
import { routing } from "@/i18n/routing";
import { findOwnedAnalysisIdForDraft } from "@/server/analyses/read-analysis";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { getDraftScopeSelection } from "@/server/drafts/scope-selection";
import { getCurrentPolicyPreview } from "@/server/policies/sample-service";

type ResultsPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string; auth_error?: string }>;
}>;

// Demo-Stati für die verschwommene Vorschau; sie stammen aus keiner Bewertung.
const previewStatuses: ResultStatus[] = [
  "partially_fulfilled",
  "not_fulfilled",
  "fulfilled",
  "fulfilled",
  "partially_fulfilled",
  "not_fulfilled",
  "partially_fulfilled",
  "fulfilled",
  "not_applicable",
  "partially_fulfilled",
];

export default async function ResultsPage({ params, searchParams }: ResultsPageProps) {
  const { locale } = await params;
  const { draft, auth_error: authCallbackError } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const localAuthBypass =
    process.env.NODE_ENV !== "production" && process.env.LOCAL_AUTH_BYPASS === "true";
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
    // Ohne Draft-Bindung lässt sich die Vorschau nicht rekonstruieren — der
    // Bindungs-Cookie ist der Eigentumsnachweis am anonymen Draft. Angemeldete
    // Nutzer beginnen neu, nicht angemeldete gehen auf die Anmeldefläche, die
    // ohne Cookie funktioniert und den Fehler erklären kann.
    redirect(
      user
        ? `/${locale}/analyses/new/framework`
        : `/${locale}/sign-in${authCallbackError ? `?auth_error=${encodeURIComponent(authCallbackError)}` : ""}`,
    );
  }
  const callbackUrl = `/${locale}/analyses/new/results?draft=${encodeURIComponent(boundDraft.id)}`;
  const includedKeys = new Set(scope.includedRequirementKeys);
  const previewItems: ResultItem[] = doraDemoRelease.requirements
    .filter((requirement) => includedKeys.has(requirement.externalKey))
    .map((requirement, index) => {
      const evidenceBlock = policyPreview.blocks[(index * 3 + 2) % policyPreview.blocks.length];
      const status = previewStatuses[index % previewStatuses.length] ?? "no_assessment_possible";
      return {
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
        aiStatus: status,
        status,
        override: null,
        explanation:
          "Die Policy enthält einzelne inhaltliche Anknüpfungspunkte. Für eine belastbare Bewertung müssen Zuständigkeit, Umsetzung und Nachweisführung gemeinsam gegen die regulatorische Anforderung geprüft werden.",
        missingInformation: ["Nachweis der operativen Umsetzung und regelmäßigen Kontrolle"],
        confidencePercent: 86 - (index % 4) * 4,
        verificationStatus: "passed",
        confirmedAt: null,
        evidence: evidenceBlock
          ? [
              {
                id: `preview-evidence-${requirement.externalKey}`,
                documentBlockId: evidenceBlock.id,
                citationOrder: 1,
                support: "context",
                exactQuote: evidenceBlock.canonicalText,
                pageNumber: evidenceBlock.pageNumber,
                paragraphNumber: evidenceBlock.paragraphNumber,
              },
            ]
          : [],
      };
    });
  const provider = aiProviderPublicDetails[scope.modelSelection.routeProvider];

  return (
    <ApplicationShell
      activeArea="analysis"
      activeStep="results"
      locale={locale}
      topbar={
        <>
          <strong className="topbar-title">{navigation("results")}</strong>
          <div className="topbar-actions">
            <LanguageMenu locale={locale} pathname="/analyses/new/results" />
          </div>
        </>
      }
    >
      <PreviewGate
        callbackUrl={callbackUrl}
        authCallbackError={authCallbackError}
        localAuthBypass={localAuthBypass}
        draftId={boundDraft.id}
        locale={locale}
        frameworkSlug={boundDraft.frameworkSlug ?? "dora"}
        policyName={policyPreview.selection.filename}
        organizationContext={scope.organizationContext}
        previewItems={previewItems}
        previewDocumentBlocks={policyPreview.blocks}
        resultLabels={resultLabels}
        selectedModel={{
          providerModelId: scope.modelSelection.providerModelId,
          routeProvider: scope.modelSelection.routeProvider,
          routeProviderLabel: provider.label,
          credentialHelpUrl: provider.credentialHelpUrl,
          privacyAttestationRequired: provider.privacyAttestationRequired,
        }}
        labels={{
          preparing: t("preparing"),
          parsing: t("parsing"),
          mapping: t("mapping"),
          checking: t("checking"),
          startFailed: t("startFailed"),
          goToSignIn: t("goToSignIn"),
          lockedTitle: t("lockedTitle"),
          lockedBody: t("lockedBody"),
          email: t("email"),
          magicLink: t("magicLink"),
          magicLinkResend: t("magicLinkResend"),
          emailSent: t("emailSent"),
          magicLinkBrowserHint: t("magicLinkBrowserHint"),
          magicLinkMode: t("magicLinkMode"),
          passwordMode: t("passwordMode"),
          password: t("password"),
          signIn: t("signIn"),
          signUp: t("signUp"),
          switchToSignIn: t("switchToSignIn"),
          switchToSignUp: t("switchToSignUp"),
          authFailed: t("authFailed"),
          accountExists: t("accountExists"),
          invalidCredentials: t("invalidCredentials"),
          passwordTooShort: t("passwordTooShort"),
          tooManyAttempts: t("tooManyAttempts"),
          google: t("google"),
          microsoft: t("microsoft"),
          or: t("or"),
          byokTitle: t("byokTitle"),
          byokBody: t("byokBody"),
          selectedModel: t("selectedModel"),
          connect: t("connect"),
          connecting: t("connecting"),
          keyLink: t("keyLink"),
          keyFailed: t("keyFailed"),
          privacyAttestation: t("privacyAttestation"),
          unlockResult: t("unlockResult"),
          close: t("close"),
        }}
      />
    </ApplicationShell>
  );
}
