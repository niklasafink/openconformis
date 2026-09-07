import { NextResponse } from "next/server";
import { z } from "zod";

import { AnalysisStartError, startAnalysis } from "@/server/analyses/start-analysis";
import { describeStartFailure } from "@/server/analyses/start-failure-messages";
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

const statusByCode: Record<string, number> = {
  DATABASE_UNAVAILABLE: 503,
  DRAFT_NOT_FOUND: 404,
  DRAFT_NOT_ACTIVE: 409,
  DRAFT_ALREADY_CLAIMED: 409,
  FRAMEWORK_RELEASE_NOT_FOUND: 409,
  SCOPE_RELEASE_MISMATCH: 409,
  SCOPE_INVALID: 409,
  POLICY_NOT_READY: 409,
  MODEL_SELECTION_NOT_FOUND: 409,
  BYOK_CREDENTIAL_INVALID: 409,
  BYOK_ROUTE_NOT_EXECUTABLE: 409,
  BYOK_PRIVACY_ATTESTATION_REQUIRED: 409,
};

function failure(code: string, status: number) {
  return NextResponse.json({ code, message: describeStartFailure(code) }, { status });
}

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) return failure("UNTRUSTED_ORIGIN", 403);

  try {
    assertRequestSize(request, 16_384);
    await enforceRequestRateLimit(request, {
      bucket: "analysis-start",
      limit: 10,
      windowSeconds: 3600,
    });
    const result = await startAnalysis(inputSchema.parse(await request.json()));
    return NextResponse.json(result, { status: result.reused ? 200 : 202 });
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    if (error instanceof z.ZodError) return failure("INVALID_ANALYSIS_START", 400);
    if (error instanceof AuthenticationRequiredError) {
      return failure("AUTHENTICATION_REQUIRED", 401);
    }
    if (error instanceof VerifiedEmailRequiredError) return failure("VERIFIED_EMAIL_REQUIRED", 403);

    const code = error instanceof AnalysisStartError ? error.code : "ANALYSIS_START_FAILED";
    return failure(code, statusByCode[code] ?? 500);
  }
}
