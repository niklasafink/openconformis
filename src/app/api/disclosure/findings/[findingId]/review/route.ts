import { NextResponse } from "next/server";

import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { reviewFinding } from "@/server/disclosure/finding-review";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Übernehmen, Bestätigen, Freigeben, Ablehnen oder Kommentieren einer Feststellung.
 * Rolle, Mitgliedschaft und „Prüfer ≠ Manager“ prüft der Server, auch bei einem
 * manipulierten Request.
 */
export async function POST(request: Request, context: { params: Promise<{ findingId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 16_384);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-finding-review",
      limit: 120,
      windowSeconds: 600,
    });
    const { findingId } = await context.params;
    const result = await reviewFinding(findingId, await request.json());
    return NextResponse.json(result, { headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-finding-review");
  }
}
