import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { NewReviewForm } from "@/components/reviews/new-review-form";
import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listReviewTables } from "@/server/review/read-review";

import { createReview } from "./actions";

type ReviewListPageProps = Readonly<{ params: Promise<{ locale: string }> }>;

export const dynamic = "force-dynamic";

/** Alle Prüfungen des Arbeitsbereichs, neueste zuerst, plus „Neue Prüfung". */
export default async function ReviewListPage({ params }: ReviewListPageProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [t, format, tables] = await Promise.all([
    getTranslations("Review"),
    getFormatter(),
    listReviewTables().catch(() => []),
  ]);
  const errorMessages = t.raw("errors") as Record<string, string>;

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={t("listEyebrow")}
        actions={<LanguageMenu locale={locale} pathname="/reviews" />}
      />
      <div className="workspace-content min-w-0">
        <div className="grid gap-5 px-4 pb-6 md:px-6">
          <NewReviewForm
            locale={locale}
            createAction={createReview}
            errorMessages={errorMessages}
          />
          {tables.length === 0 ? (
            <div className="grid max-w-xl gap-1 rounded-lg border border-dashed border-border px-5 py-8">
              <p className="text-body font-medium">{t("emptyList")}</p>
              <p className="text-meta text-muted-foreground">{t("emptyListHint")}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 px-4 text-meta font-medium">
                      {t("listName")}
                    </TableHead>
                    <TableHead className="w-48 text-meta font-medium">{t("listUpdated")}</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tables.map((table) => (
                    <TableRow key={table.id} className="h-11">
                      <TableCell className="px-4 font-medium">
                        <Link
                          href={`/reviews/${table.id}`}
                          locale={locale}
                          className="hover:underline"
                        >
                          {table.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {format.dateTime(table.updatedAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/reviews/${table.id}`}
                          locale={locale}
                          className="text-control text-muted-foreground hover:text-foreground"
                        >
                          {t("listOpen")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
