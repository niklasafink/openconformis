import { NextResponse } from "next/server";

import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { completeEvidenceUpload } from "@/server/disclosure/evidence";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Abschluss des Uploads einer Belegdatei; startet das Lesen der Konten. */
export async function POST(
  request: Request,
  context: { params: Promise<{ evidenceFileId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    const { evidenceFileId } = await context.params;
    const result = await completeEvidenceUpload(evidenceFileId);
    return NextResponse.json(result, { status: 202, headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-evidence-complete");
  }
}
