import { NextResponse } from "next/server";
import { z } from "zod";

import { AnalysisStartError, startByokAnalysis } from "@/server/analyses/start-analysis";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";

export const runtime = "nodejs";

const inputSchema = z.object({ draftId: z.uuid(), credentialId: z.uuid() });

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }

  try {
    assertRequestSize(request, 16_384);
    await enforceRequestRateLimit(request, {
      bucket: "byok-analysis-start",
      limit: 10,
      windowSeconds: 3600,
    });
    const input = inputSchema.parse(await request.json());
    const result = await startByokAnalysis({
      expectedDraftId: input.draftId,
      credentialId: input.credentialId,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_BYOK_ANALYSIS_START" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (error instanceof VerifiedEmailRequiredError) {
      return NextResponse.json({ code: "VERIFIED_EMAIL_REQUIRED" }, { status: 403 });
    }
    const code = error instanceof AnalysisStartError ? error.code : "BYOK_ANALYSIS_START_FAILED";
    const status = new Map<string, number>([
      ["DATABASE_UNAVAILABLE", 503],
      ["DRAFT_NOT_FOUND", 404],
      ["DRAFT_NOT_ACTIVE", 409],
      ["DRAFT_ALREADY_CLAIMED", 409],
      ["FRAMEWORK_RELEASE_NOT_FOUND", 409],
      ["SCOPE_RELEASE_MISMATCH", 409],
      ["SCOPE_INVALID", 409],
      ["POLICY_NOT_READY", 409],
      ["MODEL_SELECTION_NOT_FOUND", 409],
      ["BYOK_CREDENTIAL_REQUIRED", 400],
      ["BYOK_CREDENTIAL_INVALID", 409],
      ["BYOK_ROUTE_NOT_EXECUTABLE", 409],
      ["BYOK_PRIVACY_ATTESTATION_REQUIRED", 409],
    ]).get(code);
    return NextResponse.json({ code }, { status: status ?? 500 });
  }
}
