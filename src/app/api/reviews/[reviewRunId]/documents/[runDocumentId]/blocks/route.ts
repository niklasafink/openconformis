import { NextResponse } from "next/server";
import { z } from "zod";

import { getReviewDocumentBlocks } from "@/server/review/read-review";
import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ reviewRunId: z.uuid(), runDocumentId: z.uuid() });

/** Die Textblöcke eines Vertrags im Lauf — für die Belegansicht im Zell-Detail. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ reviewRunId: string; runDocumentId: string }> },
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const document = await getReviewDocumentBlocks(params);
    if (!document) return reviewFailure("REVIEW_RUN_NOT_FOUND");
    return NextResponse.json(document, { headers: reviewNoStore });
  } catch (error) {
    return reviewErrorResponse(error, "review-document-blocks");
  }
}
