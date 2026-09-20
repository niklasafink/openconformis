import { NextResponse } from "next/server";
import { z } from "zod";

import { getReviewCellDetail } from "@/server/review/read-review";
import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ reviewRunId: z.uuid(), cellId: z.uuid() });

/** Das Detail einer Zelle: Begründung, nummerierte Belege, Verteilung, Überschreibungen. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ reviewRunId: string; cellId: string }> },
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const detail = await getReviewCellDetail(params);
    if (!detail) return reviewFailure("REVIEW_CELL_NOT_FOUND");
    return NextResponse.json(detail, { headers: reviewNoStore });
  } catch (error) {
    return reviewErrorResponse(error, "review-cell");
  }
}
