import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createPolicyUploadIntent } from "@/server/policies/upload-service";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

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
    const result = await createPolicyUploadIntent(await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    if (error instanceof ZodError) {
      return NextResponse.json({ code: "INVALID_UPLOAD" }, { status: 400 });
    }

    const internalCode = error instanceof Error ? error.message : "UPLOAD_INTENT_FAILED";
    const code = new Set(["DRAFT_NOT_FOUND", "DATABASE_UNAVAILABLE"]).has(internalCode)
      ? internalCode
      : "UPLOAD_INTENT_FAILED";
    const status = code === "DRAFT_NOT_FOUND" ? 401 : code === "DATABASE_UNAVAILABLE" ? 503 : 500;
    return NextResponse.json({ code }, { status });
  }
}
