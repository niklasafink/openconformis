import { ArrowLeft } from "lucide-react";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ChecklistEditor } from "@/components/disclosure/checklist-editor";
import { LanguageMenu } from "@/components/shell/language-menu";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readChecklist } from "@/server/disclosure/checklists";

type PageProps = Readonly<{
  params: Promise<{ locale: string; checklistId: string }>;
  searchParams: Promise<{ case?: string }>;
}>;

export const dynamic = "force-dynamic";

/**
 * Bearbeitungsseite einer eigenen Checkliste: Herkunftszeile, Hinweis auf eine neuere
 * Vorlage (ohne Zusammenführen) und die Tabelle der Positionen.
 */
export default async function ChecklistPage({ params, searchParams }: PageProps) {
  const { locale, checklistId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("Disclosure.checklists");
  const caseId = z.uuid().safeParse((await searchParams).case).data;
  const checklist = z.uuid().safeParse(checklistId).success
    ? await readChecklist(checklistId)
    : null;
  const back = caseId ? `/disclosure/${caseId}/completeness` : "/disclosure";
  const pathname = `/disclosure/checklists/${checklistId}${caseId ? `?case=${caseId}` : ""}`;

  return (
    <>
      <PageHeader
        title={checklist?.title ?? t("notFound")}
        eyebrow={t("eyebrow")}
        actions={<LanguageMenu locale={locale} pathname={pathname} />}
      />
      <div className="workspace-content min-w-0">
        <div className="grid gap-4 px-4 pb-10 md:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2">
              <Link href={back} locale={locale}>
                <ArrowLeft aria-hidden="true" />
                {t("back")}
              </Link>
            </Button>
            {checklist ? (
              <p className="text-meta text-muted-foreground" data-testid="checklist-origin">
                {t("origin", {
                  title: checklist.origin.title,
                  version: checklist.origin.version,
                })}{" "}
                · {t("count", { count: checklist.items.length })}
              </p>
            ) : null}
          </div>
          {checklist?.newerVersion ? (
            <p
              className="rounded-md border border-[var(--status-partial)] bg-[var(--status-partial-bg)] px-3 py-2 text-meta"
              data-testid="checklist-newer"
            >
              {t("newer", { version: checklist.newerVersion })}
            </p>
          ) : null}
          {checklist ? (
            <ChecklistEditor
              checklistId={checklist.id}
              title={checklist.title}
              items={checklist.items}
              canEdit={checklist.canEdit}
              issueLabels={
                (await getTranslations("Disclosure")).raw("checklistIssues") as Record<
                  string,
                  string
                >
              }
              errorMessages={t.raw("errors") as Record<string, string>}
            />
          ) : (
            <p className="text-body">{t("notFound")}</p>
          )}
        </div>
      </div>
    </>
  );
}
