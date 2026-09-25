import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { LanguageMenu } from "@/components/shell/language-menu";
import { PageHeader } from "@/components/shell/page-header";
import { Link } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { getDisclosureCase } from "@/server/disclosure/read-case";

/** Gemeinsamer Einstieg beider Reiter: Sprache prüfen, Prüfung laden. */
export async function loadCasePage(params: Promise<{ locale: string; caseId: string }>) {
  const { locale, caseId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const found = await getDisclosureCase(caseId);
  return { locale: locale as AppLocale, caseId, found };
}

export async function CaseNotFound({ locale }: Readonly<{ locale: AppLocale }>) {
  const t = await getTranslations("Disclosure");
  return (
    <>
      <PageHeader
        title={t("title")}
        actions={<LanguageMenu locale={locale} pathname="/disclosure" />}
      />
      <div className="workspace-content min-w-0">
        <div className="grid gap-2 px-4 md:px-6">
          <p className="text-body">{t("notFound")}</p>
          <Link
            href="/disclosure"
            locale={locale}
            className="text-control underline underline-offset-2"
          >
            {t("backToList")}
          </Link>
        </div>
      </div>
    </>
  );
}
