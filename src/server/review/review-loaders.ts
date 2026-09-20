import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { ReviewColumnSnapshot } from "@/domain/review/column";
import { db } from "@/server/db/client";
import { documentBlocks } from "@/server/db/schema/documents";
import { reviewRunColumns, reviewRuns } from "@/server/db/schema/reviews";

import type { ReviewBlock } from "./review-decision";

/** Der Lauf samt seiner eingefrorenen Konfiguration. */
export async function loadReviewRun(reviewRunId: string) {
  const [run] = await db.select().from(reviewRuns).where(eq(reviewRuns.id, reviewRunId)).limit(1);
  if (!run) throw new Error("REVIEW_RUN_NOT_FOUND");
  return run;
}

export type ReviewRun = Awaited<ReturnType<typeof loadReviewRun>>;

export function isReviewRunLive(status: ReviewRun["status"]) {
  return status === "queued" || status === "running";
}

export type RunColumn = {
  runColumnId: string;
  ordinal: number;
  snapshot: ReviewColumnSnapshot;
};

export async function loadRunColumns(reviewRunId: string): Promise<RunColumn[]> {
  const rows = await db
    .select()
    .from(reviewRunColumns)
    .where(eq(reviewRunColumns.reviewRunId, reviewRunId))
    .orderBy(asc(reviewRunColumns.ordinal));
  return rows.map((row) => ({
    runColumnId: row.id,
    ordinal: row.ordinal,
    snapshot: {
      label: row.label,
      columnType: row.columnType,
      instructions: row.instructions,
      criteria: row.criteria,
    },
  }));
}

/** Die Blöcke eines Vertrags in Dokumentreihenfolge — einmal je Schritt geladen. */
export type LoadedReviewBlock = ReviewBlock & { headingPath: string[] };

export async function loadReviewBlocks(policyVersionId: string): Promise<LoadedReviewBlock[]> {
  const rows = await db
    .select({
      documentBlockId: documentBlocks.id,
      blockKey: documentBlocks.blockKey,
      ordinal: documentBlocks.ordinal,
      canonicalText: documentBlocks.canonicalText,
      tokenCount: documentBlocks.tokenCount,
      textHash: documentBlocks.textHash,
      pageNumber: documentBlocks.pageNumber,
      paragraphNumber: documentBlocks.paragraphNumber,
      headingPath: documentBlocks.headingPath,
    })
    .from(documentBlocks)
    .where(and(eq(documentBlocks.policyVersionId, policyVersionId)))
    .orderBy(asc(documentBlocks.ordinal));
  return rows;
}
