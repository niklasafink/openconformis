import { NextResponse } from "next/server";

import { reviewCompletenessResult } from "@/server/disclosure/completeness-review";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bestätigen, Überschreiben, Freigeben, Ablehnen oder Kommentieren einer Position der
 * Vollständigkeitsprüfung — mit denselben Serverregeln wie bei den Feststellungen.
 */
export async function POST(request: Request, context: { params: Promise<{ resultId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 16_384);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-completeness-review",
      limit: 120,
      windowSeconds: 600,
    });
    const { resultId } = await context.params;
    const result = await reviewCompletenessResult(resultId, await request.json());
    return NextResponse.json(result, { headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-completeness-review");
  }
}
