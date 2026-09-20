import { NextResponse } from "next/server";
import { z } from "zod";

import { defaultDeltaLimit, getReviewCellDelta } from "@/server/review/read-review";
import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(defaultDeltaLimit),
});

/**
 * Das Delta: nur Zellen mit `changeSeq > since`. Es enthält aktualisierte Zellen ebenso
 * wie neue. Begründung und Belegtext fehlen mit Absicht — die holt das Aufklappen einer
 * Zelle über `…/cells/[cellId]`.
 */
export async function GET(request: Request, context: { params: Promise<{ reviewRunId: string }> }) {
  try {
    const reviewRunId = z.uuid().parse((await context.params).reviewRunId);
    const url = new URL(request.url);
    const query = querySchema.parse({
      since: url.searchParams.get("since") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const delta = await getReviewCellDelta({ reviewRunId, ...query });
    if (!delta) return reviewFailure("REVIEW_RUN_NOT_FOUND");
    return NextResponse.json(delta, { headers: reviewNoStore });
  } catch (error) {
    return reviewErrorResponse(error, "review-cells");
  }
}
