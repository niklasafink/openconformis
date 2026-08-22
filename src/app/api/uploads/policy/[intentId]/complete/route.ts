import { NextResponse } from "next/server";
import { z } from "zod";

import { completePolicyUploadIntent } from "@/server/policies/upload-service";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

const completionSchema = z.object({ draftId: z.uuid() });

type CompletionRouteProps = { params: Promise<{ intentId: string }> };

export async function POST(request: Request, { params }: CompletionRouteProps) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  try {
    assertRequestSize(request, 16_384);
    await enforceRequestRateLimit(request, {
      bucket: "policy-upload-completion",
      limit: 12,
      windowSeconds: 600,
    });
    const { intentId } = await params;
    const { draftId } = completionSchema.parse(await request.json());
    return NextResponse.json(await completePolicyUploadIntent(intentId, draftId));
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_COMPLETION" }, { status: 400 });
    }

    const code = error instanceof Error ? error.message : "UPLOAD_COMPLETION_FAILED";
    const unauthorized = code === "DRAFT_NOT_FOUND" || code === "UPLOAD_NOT_FOUND";
    const invalid = new Set([
      "INVALID_INTENT",
      "UPLOAD_NOT_ACTIVE",
      "UPLOAD_EXPIRED",
      "OBJECT_NOT_FOUND",
      "UPLOAD_METADATA_MISMATCH",
    ]).has(code);
    return NextResponse.json({ code }, { status: unauthorized ? 401 : invalid ? 409 : 500 });
  }
}
