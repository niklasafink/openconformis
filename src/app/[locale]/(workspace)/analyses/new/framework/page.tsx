import { ArrowRight, Search } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { FrameworkTable } from "@/components/frameworks/framework-table";
import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getSelectableFramework, listFrameworkCatalogue } from "@/server/catalogue/service";

import { continueFromFramework } from "./actions";

type AvailabilityFilter = "all" | "available" | "unavailable";

type FrameworkPageProps = Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ framework?: string; q?: string; availability?: string }>;
}>;

function parseFilter(value: string | undefined): AvailabilityFilter {
  return value === "available" || value === "unavailable" ? value : "all";
}

export default async function FrameworkPage({ params, searchParams }: FrameworkPageProps) {
  const { locale } = await params;
  const { framework: selectedId, q = "", availability } = await searchParams;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const filter = parseFilter(availability);
  const [t, topbar] = await Promise.all([getTranslations("Framework"), getTranslations("Topbar")]);
  const [selectedFramework, catalogue] = await Promise.all([
    getSelectableFramework(selectedId, locale),
    listFrameworkCatalogue(locale, q),
  ]);
  const visibleFrameworks = catalogue.filter((framework) =>
    filter === "all"
      ? true
      : filter === "available"
        ? framework.availability === "included"
        : framework.availability !== "included",
  );
  const filters: Array<{ id: AvailabilityFilter; label: string }> = [
    { id: "all", label: t("all") },
    { id: "available", label: t("available") },
    { id: "unavailable", label: t("unavailable") },
  ];
  const baseQuery: Record<string, string> = {};
  if (q) baseQuery.q = q;
  if (selectedFramework) baseQuery.framework = selectedFramework.id;

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={t("step")}
        actions={
          <>
            <form
              role="search"
              className="relative hidden sm:block"
              action={`/${locale}/analyses/new/framework`}
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
                placeholder={topbar("searchFrameworks")}
                aria-label={topbar("searchFrameworks")}
                className="h-8 w-60 rounded-full bg-card pl-8"
              />
              {selectedFramework ? (
                <input type="hidden" name="framework" value={selectedFramework.id} />
              ) : null}
              {filter !== "all" ? <input type="hidden" name="availability" value={filter} /> : null}
            </form>
            <LanguageMenu locale={locale} pathname="/analyses/new/framework" />
          </>
        }
      />
      <div className="workspace-content min-w-0">
        <div className="flex min-h-[calc(100dvh-56px)] flex-col gap-4 px-4 pb-4 md:px-6 md:pb-6">
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={t("columnStatus")}
          >
            {filters.map((entry) => (
              <Button
                key={entry.id}
                asChild
                variant={entry.id === filter ? "secondary" : "ghost"}
                size="sm"
                className="rounded-full px-3.5 data-active:bg-card data-active:shadow-xs data-active:ring-1 data-active:ring-border"
              >
                <Link
                  locale={locale}
                  href={{
                    pathname: "/analyses/new/framework",
                    query:
                      entry.id === "all" ? baseQuery : { ...baseQuery, availability: entry.id },
                  }}
                  aria-current={entry.id === filter ? "true" : undefined}
                  data-active={entry.id === filter || undefined}
                >
                  {entry.label}
                </Link>
              </Button>
            ))}
          </div>

          <div className="flex flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
            <FrameworkTable
              frameworks={visibleFrameworks}
              locale={locale}
              query={q}
              selectedId={selectedFramework?.id}
            />
          </div>

          <div className="flex justify-end">
            {selectedFramework ? (
              <form action={continueFromFramework}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="framework" value={selectedFramework.id} />
                <Button type="submit" className="rounded-full px-4">
                  <span>{t("continue")}</span>
                  <ArrowRight aria-hidden="true" />
                </Button>
              </form>
            ) : (
              <Button type="button" disabled className="rounded-full px-4">
                {t("chooseToContinue")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
