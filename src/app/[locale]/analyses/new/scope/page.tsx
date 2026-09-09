import { Search } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { ScopeForm } from "@/components/scope/scope-form";
import { Input } from "@/components/ui/input";
import { routing } from "@/i18n/routing";
import { getAnalysisModelCatalogue } from "@/server/ai/model-catalogue";
import { getPublishedFrameworkRelease } from "@/server/catalogue/service";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import { getDraftScopeSelection } from "@/server/drafts/scope-selection";
import { getCurrentPolicySelection } from "@/server/policies/sample-service";

import { saveScopeAndContinue } from "./actions";

type ScopePageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ draft?: string; q?: string }>;
}>;

export default async function ScopePage({ params, searchParams }: ScopePageProps) {
  const { locale } = await params;
  const { draft, q = "" } = await searchParams;

  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [t, boundDraft, selection, savedScope, modelCatalogue] = await Promise.all([
    getTranslations("Scope"),
    getBoundActiveDraft(draft),
    getCurrentPolicySelection(draft),
    getDraftScopeSelection(draft),
    getAnalysisModelCatalogue(),
  ]);
  // Ohne aktiven Draft (kein Rahmenwerk oder keine Policy gewählt) lässt sich der
  // Umfang nicht rekonstruieren. Der Sidebar-Schritt ist immer sichtbar, auch
  // bevor der Ablauf begonnen wurde — ein 404 wäre eine Sackgasse statt eines
  // Wegs zurück zum Anfang des Ablaufs.
  if (!boundDraft?.frameworkSlug || !selection) redirect(`/${locale}/analyses/new/framework`);
  const release = await getPublishedFrameworkRelease(boundDraft.frameworkSlug);
  if (!release) notFound();
  const initialIncludedKeys =
    savedScope?.includedRequirementKeys ??
    release.requirements.map((requirement) => requirement.externalKey);

  return (
    <ApplicationShell
      activeArea="analysis"
      activeStep="scope"
      locale={locale}
      title={t("title")}
      eyebrow={t("step")}
      actions={
        <>
          <form
            role="search"
            className="relative hidden sm:block"
            action={`/${locale}/analyses/new/scope`}
          >
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder={t("search")}
              aria-label={t("search")}
              className="h-8 w-60 rounded-full bg-card pl-8"
            />
            <input type="hidden" name="draft" value={boundDraft.id} />
          </form>
          <LanguageMenu locale={locale} pathname="/analyses/new/scope" />
        </>
      }
    >
      <div className="setup-page scope-setup-page">
        <div className="scope-page-meta">
          <span>{release.frameworkSlug.toLocaleUpperCase(locale)}</span>
          <span aria-hidden="true">·</span>
          <span>{selection.filename}</span>
        </div>

        <ScopeForm
          action={saveScopeAndContinue}
          draftId={boundDraft.id}
          locale={locale}
          requirements={release.requirements}
          initialSize={savedScope?.institutionSize ?? "medium"}
          initialContext={savedScope?.organizationContext ?? ""}
          initialIncludedKeys={initialIncludedKeys}
          query={q}
          modelCatalogue={modelCatalogue}
          initialModelProfileId={savedScope?.modelSelection?.modelProfileId}
          labels={{
            size: t("size"),
            sizeHelp: t("sizeHelp"),
            small: t("small"),
            medium: t("medium"),
            large: t("large"),
            requirement: t("requirement"),
            subrequirements: t("subrequirements"),
            bestPractice: t("bestPractice"),
            details: t("details"),
            noSubrequirements: t("noSubrequirements"),
            context: t("context"),
            contextPlaceholder: t("contextPlaceholder"),
            included: t("included"),
            start: t("start"),
            model: t("model"),
            evaluated: t("evaluated"),
            unevaluated: t("unevaluated"),
            unevaluatedWarning: t("unevaluatedWarning"),
          }}
        />
      </div>
    </ApplicationShell>
  );
}
