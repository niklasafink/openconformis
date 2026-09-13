import { NextResponse } from "next/server";
import { z } from "zod";

import { analysisRerunInputSchema } from "@/domain/analysis/rerun-input";
import { CredentialValidationError } from "@/server/ai/credential-validation";
import { ModelProviderError } from "@/server/ai/structured-model";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
import { rerunAnalysis } from "@/server/analyses/rerun-analysis";
import { AnalysisStartError } from "@/server/analyses/start-analysis";
import { describeStartFailure } from "@/server/analyses/start-failure-messages";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import {
  assertRequestSize,
  enforceRequestRateLimit,
  requestProtectionResponse,
} from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusByCode: Record<string, number> = {
  DATABASE_UNAVAILABLE: 503,
  ANALYSIS_NOT_FOUND: 404,
  MODEL_SELECTION_NOT_FOUND: 409,
  UNEVALUATED_MODEL_WARNING_REQUIRED: 409,
  BYOK_ROUTE_NOT_EXECUTABLE: 409,
  SCOPE_INVALID: 409,
};

function failure(code: string, status: number) {
  return NextResponse.json(
    { code, message: describeStartFailure(code) },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

/**
 * Neuer Lauf aus dem Ergebnis heraus. Der Schlüssel steht nur im Request-Body,
 * wird sofort verschlüsselt gespeichert und nie zurückgegeben.
 */
export async function POST(request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return failure("UNTRUSTED_ORIGIN", 403);

  try {
    assertRequestSize(request, 131_072);
    await enforceRequestRateLimit(request, {
      bucket: "analysis-start",
      limit: 10,
      windowSeconds: 3600,
    });
    const analysisId = z.uuid().parse((await context.params).analysisId);
    const input = analysisRerunInputSchema.parse(await request.json());
    const result = await rerunAnalysis(analysisId, input);
    return NextResponse.json(
      { analysisId: result.analysisId, status: result.status },
      { status: result.reused ? 200 : 202, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const protectedResponse = requestProtectionResponse(error);
    if (protectedResponse) return protectedResponse;
    if (error instanceof z.ZodError) return failure("INVALID_ANALYSIS_START", 400);
    if (error instanceof AuthenticationRequiredError) {
      return failure("AUTHENTICATION_REQUIRED", 401);
    }
    if (error instanceof VerifiedEmailRequiredError) return failure("VERIFIED_EMAIL_REQUIRED", 403);
    if (error instanceof AnalysisStartError) {
      return failure(error.code, statusByCode[error.code] ?? 500);
    }
    // Schlüsselfehler behalten die Codes der Schlüsselverbindung, damit die
    // Oberfläche dieselbe Ursache nennt wie beim ersten Start.
    if (error instanceof CredentialValidationError) {
      return failure(error.code, error.code === "PROVIDER_UNAVAILABLE" ? 503 : 422);
    }
    if (error instanceof TemporaryCredentialError) return failure(error.code, 409);
    if (error instanceof ModelProviderError) return failure(error.code, 503);
    console.error("[analysis-rerun] failed", error instanceof Error ? error.name : typeof error);
    return failure("ANALYSIS_START_FAILED", 500);
  }
}
