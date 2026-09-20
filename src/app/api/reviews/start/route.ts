import { NextResponse } from "next/server";

import { reviewStartInputSchema, startReview } from "@/server/review/start-review";
import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Startet eine Vertragsprüfung für eine Prüfung (`reviewTableId` im Body). Der Lauf
 * entsteht erst hier; deshalb gibt es keine Lauf-ID im Pfad, sondern sie kommt in der
 * Antwort zurück. Ein doppelter Aufruf übernimmt den offenen Lauf (`reused: true`).
 * Schlüssel stehen nur im Body, nie in der URL.
 */
export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) return reviewFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 32_768);
    await enforceRequestRateLimit(request, {
      bucket: "review-start",
      limit: 10,
      windowSeconds: 3600,
    });
    const result = await startReview(reviewStartInputSchema.parse(await request.json()));
    return NextResponse.json(result, {
      status: result.reused ? 200 : 202,
      headers: reviewNoStore,
    });
  } catch (error) {
    return reviewErrorResponse(error, "review-start");
  }
}
