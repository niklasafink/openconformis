import { NextResponse } from "next/server";
import { z } from "zod";

import { getReviewRunHead } from "@/server/review/read-review";
import { reviewErrorResponse, reviewFailure } from "@/server/review/review-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Der Taktgeber des Live-Rasters: eine Zeile mit Status, Fortschritt, Zählern und
 * `headSeq`. Der ETag trägt `headSeq` **und** den Änderungsstand des Laufs — ein
 * reines `headSeq` liesse einen Statuswechsel ohne Zelländerung (etwa das Ende des
 * Laufs) als „nichts Neues" durchgehen.
 */
export async function GET(request: Request, context: { params: Promise<{ reviewRunId: string }> }) {
  try {
    const reviewRunId = z.uuid().parse((await context.params).reviewRunId);
    const head = await getReviewRunHead(reviewRunId);
    if (!head) return reviewFailure("REVIEW_RUN_NOT_FOUND");

    const etag = `W/"${head.headSeq}-${Date.parse(head.updatedAt)}"`;
    const headers = { "cache-control": "private, no-cache", etag };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return NextResponse.json(head, { headers });
  } catch (error) {
    return reviewErrorResponse(error, "review-head");
  }
}
