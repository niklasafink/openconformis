import { NextResponse } from "next/server";
import { z } from "zod";

import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { createEvidenceUploadIntent } from "@/server/disclosure/evidence";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload-Absicht für eine Belegdatei (SuSa, nur `.xlsx`). Die Datei selbst geht direkt
 * in den privaten Blob, weil sie über dem Vercel-Body-Limit liegen darf.
 */
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 8_192);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-evidence-intent",
      limit: 20,
      windowSeconds: 600,
    });
    const caseId = z.uuid().parse((await context.params).caseId);
    const result = await createEvidenceUploadIntent(caseId, await request.json());
    return NextResponse.json(result, { status: 201, headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-evidence-intent");
  }
}
