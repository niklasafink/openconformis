import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ReviewWorkspace, type RunSnapshot } from "@/components/reviews/review-workspace";
import { PageHeader } from "@/components/shell/page-header";
import { LanguageMenu } from "@/components/shell/language-menu";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { getAnalysisModelCatalogue } from "@/server/ai/model-catalogue";
import { listSavedCredentials } from "@/server/ai/saved-credential-service";
import {
  getReviewCellDelta,
  getReviewRunGrid,
  getReviewRunHead,
  getReviewTable,
} from "@/server/review/read-review";
import { resolveReviewActor, reviewPermissionsOf } from "@/server/review/review-actor";

type ReviewGridPageProps = Readonly<{ params: Promise<{ locale: string; reviewId: string }> }>;

export const dynamic = "force-dynamic";

/**
 * Das Raster einer Prüfung. `reviewId` ist die Tabelle; der jüngste Lauf liefert
 * die Zellen — als erstes Delta hier, alles Weitere holt der Client im Takt.
 */
export default async function ReviewGridPage({ params }: ReviewGridPageProps) {
  const { locale, reviewId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  if (!z.uuid().safeParse(reviewId).success) notFound();

  const [t, resultsT, review, actor, catalogue, savedCredentials] = await Promise.all([
    getTranslations("Review"),
    getTranslations("ResultsPreview"),
    getReviewTable(reviewId),
    resolveReviewActor(),
    getAnalysisModelCatalogue().catch(() => ({ version: "", fetchedAt: "", models: [] })),
    listSavedCredentials().catch(() => []),
  ]);
  const languageMenu = <LanguageMenu locale={locale} pathname={`/reviews/${reviewId}`} />;

  if (!review) {
    return (
      <>
        <PageHeader title={t("title")} actions={languageMenu} />
        <div className="workspace-content min-w-0">
          <div className="grid gap-2 px-4 md:px-6">
            <p className="text-body">{t("notFound")}</p>
            <Link
              href="/reviews"
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

  let run: RunSnapshot | null = null;
  if (review.latestRun) {
    const [head, grid, delta] = await Promise.all([
      getReviewRunHead(review.latestRun.id),
      getReviewRunGrid(review.latestRun.id),
      getReviewCellDelta({ reviewRunId: review.latestRun.id, since: 0, limit: 500 }),
    ]);
    if (head && grid && delta) {
      run = {
        head,
        documents: grid.documents.map(({ id, reviewDocumentId, displayName }) => ({
          id,
          reviewDocumentId,
          displayName,
        })),
        columns: grid.columns.map(({ id, reviewColumnId, label, columnType, criteria }) => ({
          id,
          reviewColumnId,
          label,
          columnType,
          criteria,
        })),
        cells: delta.cells,
        nextSince: delta.nextSince,
        hasMore: delta.hasMore,
      };
    }
  }

  const permissions = reviewPermissionsOf(actor);

  return (
    <>
      <PageHeader
        title={t("title")}
        eyebrow={t("gridEyebrow", { name: review.table.name })}
        actions={languageMenu}
      />
      <div className="workspace-content min-w-0">
        <ReviewWorkspace
          locale={locale}
          reviewTableId={review.table.id}
          documents={review.documents.map((document) => ({
            id: document.id,
            policyVersionId: document.policyVersionId,
            displayName: document.displayName,
            originalFilename: document.originalFilename,
            parseStatus: document.parseStatus,
            byteSize: document.byteSize,
            pageCount: document.pageCount,
          }))}
          columns={review.columns.map((column) => ({
            id: column.id,
            label: column.label,
            columnType: column.columnType,
            instructions: column.instructions,
            criteria: column.criteria,
          }))}
          run={run}
          catalogue={catalogue}
          savedCredentials={savedCredentials}
          canManage={permissions.canManage}
          canConfirm={permissions.canConfirm}
          canOverride={permissions.canOverride}
          errorMessages={t.raw("errors") as Record<string, string>}
          keyErrorMessages={resultsT.raw("keyErrors") as Record<string, string>}
        />
      </div>
    </>
  );
}
