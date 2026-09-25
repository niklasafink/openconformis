import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { docxMimeType } from "@/domain/policies/upload";
import { createPolicyUploadIntent } from "@/server/policies/upload-service";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

/**
 * Upload-Absicht für den Prüfungsbericht der Offenlegungspflicht. Dieselbe Kette wie
 * `/api/uploads/policy` (Blob-Direktupload, Abschluss, Aufbereitung), aber nur für
 * Word: ein PDF wird hier abgelehnt, bevor ein Upload-Token entsteht.
 */
export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  try {
    assertRequestSize(request, 16_384);
    await enforceRequestRateLimit(request, {
      bucket: "policy-upload-intent",
      limit: 12,
      windowSeconds: 600,
    });
    const result = await createPolicyUploadIntent(await request.json(), {
      acceptedMimeTypes: [docxMimeType],
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    const internalCode = error instanceof Error ? error.message : "";
    if (internalCode === "UNSUPPORTED_FILE_TYPE") {
      return NextResponse.json({ code: "DISCLOSURE_REPORT_DOCX_ONLY" }, { status: 400 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ code: "INVALID_UPLOAD" }, { status: 400 });
    }
    if (internalCode === "DRAFT_NOT_FOUND") {
      return NextResponse.json({ code: internalCode }, { status: 401 });
    }
    if (internalCode === "DATABASE_UNAVAILABLE") {
      return NextResponse.json({ code: internalCode }, { status: 503 });
    }
    return NextResponse.json({ code: "UPLOAD_INTENT_FAILED" }, { status: 500 });
  }
}
