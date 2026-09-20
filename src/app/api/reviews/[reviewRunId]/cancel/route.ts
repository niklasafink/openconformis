import { NextResponse } from "next/server";
import { z } from "zod";

import { cancelReviewRun } from "@/server/review/cancel-review";
import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ reviewRunId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) return reviewFailure("UNTRUSTED_ORIGIN", 403);
  try {
    const reviewRunId = z.uuid().parse((await context.params).reviewRunId);
    const result = await cancelReviewRun({ reviewRunId });
    if (!result.ok) return reviewFailure(result.code);
    return NextResponse.json(
      { reviewRunId, status: result.status, changed: result.changed },
      { headers: reviewNoStore },
    );
  } catch (error) {
    return reviewErrorResponse(error, "review-cancel");
  }
}
