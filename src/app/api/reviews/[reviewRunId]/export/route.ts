import { z } from "zod";

import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { buildReviewXlsx, createReviewExportFilename } from "@/server/exports/review-xlsx";
import { getOwnedReviewExportData } from "@/server/review/read-review";
import { resolveReviewActor } from "@/server/review/review-actor";
import { reviewErrorResponse, reviewFailure } from "@/server/review/review-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumWorkbookBytes = 16 * 1024 * 1024;

/**
 * Rasterexport als XLSX: ein Blatt Raster, ein Blatt Belege. Zellen mit Prüfbedarf oder
 * Fehler sind im Text und farbig markiert. Ein Lauf, der noch arbeitet, lässt sich nicht
 * exportieren — der Export wäre ein Zwischenstand, der wie ein Ergebnis aussähe.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ reviewRunId: string }> },
) {
  try {
    const reviewRunId = z.uuid().parse((await context.params).reviewRunId);
    const actor = await resolveReviewActor();
    const data = await getOwnedReviewExportData(reviewRunId);
    if (!data) return reviewFailure("REVIEW_RUN_NOT_FOUND");
    if (data.status === "queued" || data.status === "running") {
      return reviewFailure("REVIEW_NOT_FINISHED", 409);
    }

    const workbook = await buildReviewXlsx(data);
    if (workbook.byteLength > maximumWorkbookBytes)
      return reviewFailure("REVIEW_EXPORT_TOO_LARGE", 413);

    await appendAuditEvent(db, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "review.exported",
      targetType: "review_run",
      targetId: data.id,
      metadata: {
        format: "xlsx",
        contractCount: data.documents.length,
        cellCount: data.cells.length,
      },
    });

    const filename = createReviewExportFilename(data);
    const body = new ArrayBuffer(workbook.byteLength);
    new Uint8Array(body).set(workbook);
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "content-length": String(workbook.byteLength),
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return reviewErrorResponse(error, "review-export");
  }
}
