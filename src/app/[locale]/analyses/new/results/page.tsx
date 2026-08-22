import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { PreviewGate } from "@/components/results/preview-gate";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { aiProviderPublicDetails } from "@/domain/ai/provider";
import { routing } from "@/i18n/routing";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { getDraftScopeSelection } from "@/server/drafts/scope-selection";

type ResultsPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string }>;
}>;

export default async function ResultsPage({ params, searchParams }: ResultsPageProps) {
  const { locale } = await params;
  const { draft } = await searchParams;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [navigation, t, boundDraft, scope] = await Promise.all([
    getTranslations("Navigation"),
    getTranslations("ResultsPreview"),
    getBoundActiveDraft(draft),
    getDraftScopeSelection(draft),
  ]);
  if (!boundDraft || !scope?.modelSelection) {
    notFound();
  }
  const callbackUrl = `/${locale}/analyses/new/results?draft=${encodeURIComponent(boundDraft.id)}`;

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
        draftId={boundDraft.id}
        locale={locale}
        selectedModel={{
          providerModelId: scope.modelSelection.providerModelId,
          routeProvider: scope.modelSelection.routeProvider,
          routeProviderLabel: aiProviderPublicDetails[scope.modelSelection.routeProvider].label,
          credentialHelpUrl:
            aiProviderPublicDetails[scope.modelSelection.routeProvider].credentialHelpUrl,
          privacyAttestationRequired:
            aiProviderPublicDetails[scope.modelSelection.routeProvider].privacyAttestationRequired,
        }}
        labels={{
          preparing: t("preparing"),
          parsing: t("parsing"),
          mapping: t("mapping"),
          checking: t("checking"),
          complete: t("complete"),
          startFailed: t("startFailed"),
          lockedTitle: t("lockedTitle"),
          lockedBody: t("lockedBody"),
          email: t("email"),
          magicLink: t("magicLink"),
          emailSent: t("emailSent"),
          magicLinkMode: t("magicLinkMode"),
          passwordMode: t("passwordMode"),
          password: t("password"),
          signIn: t("signIn"),
          signUp: t("signUp"),
          switchToSignIn: t("switchToSignIn"),
          switchToSignUp: t("switchToSignUp"),
          authFailed: t("authFailed"),
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
        }}
      />
    </ApplicationShell>
  );
}
