import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { credentialErrorResponse } from "@/server/ai/credential-error-response";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { CredentialValidationError } from "@/server/ai/credential-validation";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
import { requestProtectionResponse } from "@/server/security/request-protection";

import { ReviewAccessError } from "./review-actor";
import { ReviewStartError } from "./start-review";

const noStore = { "cache-control": "private, no-store" } as const;

export const reviewNoStore = noStore;

const statusByCode: Record<string, number> = {
  DATABASE_UNAVAILABLE: 503,
  REVIEW_TABLE_NOT_FOUND: 404,
  REVIEW_RUN_NOT_FOUND: 404,
  REVIEW_CELL_NOT_FOUND: 404,
  REVIEW_NO_DOCUMENTS: 409,
  REVIEW_NO_COLUMNS: 409,
  REVIEW_TOO_LARGE: 409,
  REVIEW_DOCUMENT_NOT_READY: 409,
  REVIEW_TYPESAFE_KEY_REQUIRED: 409,
  REVIEW_MODEL_KEY_REQUIRED: 409,
  REVIEW_ENGINE_INVALID: 503,
  MODEL_SELECTION_NOT_FOUND: 409,
  BYOK_ROUTE_NOT_EXECUTABLE: 409,
  REVIEW_CELL_NOT_CONFIRMABLE: 409,
  REVIEW_CELL_NOT_SETTLED: 409,
  REVIEW_OVERRIDE_ANSWER_INVALID: 400,
  REVIEW_FORBIDDEN: 403,
  MEMBERSHIP_REQUIRED: 403,
  VERIFIED_EMAIL_REQUIRED: 403,
};

/** Dieselbe Antwortform wie die Analyse-Routen: `{ code }` mit passendem Status. */
export function reviewFailure(code: string, status?: number) {
  return NextResponse.json(
    { code },
    { status: status ?? statusByCode[code] ?? 500, headers: noStore },
  );
}

export function reviewErrorResponse(error: unknown, logTag: string) {
  const protectedResponse = requestProtectionResponse(error);
  if (protectedResponse) return protectedResponse;
  if (error instanceof z.ZodError) return reviewFailure("INVALID_REVIEW_REQUEST", 400);
  if (error instanceof AuthenticationRequiredError)
    return reviewFailure("AUTHENTICATION_REQUIRED", 401);
  if (error instanceof VerifiedEmailRequiredError)
    return reviewFailure("VERIFIED_EMAIL_REQUIRED", 403);
  if (error instanceof ReviewAccessError) return reviewFailure(error.code);
  if (error instanceof ReviewStartError) return reviewFailure(error.code);
  // Schlüsselfehler behalten ihre eigenen Codes (ungültig, gesperrt, nicht gefunden).
  if (error instanceof CredentialValidationError || error instanceof TemporaryCredentialError) {
    return credentialErrorResponse(error, logTag);
  }
  console.error(`[${logTag}] failed`, error instanceof Error ? error.name : typeof error);
  return reviewFailure("REVIEW_REQUEST_FAILED", 500);
}
