import { ArrowRight, Search } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { FrameworkGrid } from "@/components/frameworks/framework-grid";
import { ApplicationShell } from "@/components/shell/application-shell";
import { LanguageMenu } from "@/components/shell/language-menu";
import { routing } from "@/i18n/routing";
import { getSelectableFramework, listFrameworkCatalogue } from "@/server/catalogue/service";

import { continueFromFramework } from "./actions";

type FrameworkPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ framework?: string; q?: string }>;
}>;

export default async function FrameworkPage({ params, searchParams }: FrameworkPageProps) {
  const { locale } = await params;
  const { framework: selectedId, q = "" } = await searchParams;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const [t, topbar] = await Promise.all([getTranslations("Framework"), getTranslations("Topbar")]);
  const [selectedFramework, visibleFrameworks] = await Promise.all([
    getSelectableFramework(selectedId, locale),
    listFrameworkCatalogue(locale, q),
  ]);

  return (
    <ApplicationShell
      activeArea="analysis"
      activeStep="framework"
      locale={locale}
      topbar={
        <>
          <strong className="topbar-title">{topbar("framework")}</strong>
          <div className="topbar-actions">
            <form className="topbar-search" action={`/${locale}/analyses/new/framework`}>
              <Search size={15} aria-hidden="true" />
              <input
                name="q"
                type="search"
                defaultValue={q}
                placeholder={topbar("searchFrameworks")}
                aria-label={topbar("searchFrameworks")}
              />
              {selectedFramework ? (
                <input type="hidden" name="framework" value={selectedFramework.id} />
              ) : null}
            </form>
            <LanguageMenu locale={locale} pathname="/analyses/new/framework" />
          </div>
        </>
      }
    >
      <div className="setup-page">
        <div className="setup-heading">
          <p>{t("step")}</p>
          <h1>{t("title")}</h1>
        </div>

        <FrameworkGrid
          frameworks={visibleFrameworks}
          locale={locale}
          query={q}
          selectedId={selectedFramework?.id}
        />

        <div className="setup-footer">
          {selectedFramework ? (
            <form action={continueFromFramework}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="framework" value={selectedFramework.id} />
              <button className="button button-primary" type="submit">
                <span>{t("continue")}</span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </form>
          ) : (
            <button className="button button-primary" disabled type="button">
              {t("chooseToContinue")}
            </button>
          )}
        </div>
      </div>
    </ApplicationShell>
  );
}
