import { NextResponse } from "next/server";

import { createTemplateUploadIntent } from "@/server/disclosure/checklist-templates";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pfad für den Direktupload einer Excel-Vorlage in den privaten Blob. */
export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 4_096);
    await enforceRequestRateLimit(request, {
      bucket: "admin-checklist-upload",
      limit: 30,
      windowSeconds: 600,
    });
    const result = await createTemplateUploadIntent(await request.json());
    return NextResponse.json(result, { status: 201, headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "admin-checklist-upload");
  }
}
