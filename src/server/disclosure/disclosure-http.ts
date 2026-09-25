import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { credentialErrorResponse } from "@/server/ai/credential-error-response";
import { CredentialValidationError } from "@/server/ai/credential-validation";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { requestProtectionResponse } from "@/server/security/request-protection";

import { DisclosureAccessError } from "./actor";
import { ChecklistTemplateError } from "./checklist-templates";
import { ChecklistError } from "./checklists";
import { DisclosureEvidenceError } from "./evidence";
import { DisclosureReviewError } from "./review-core";
import { DisclosureRunError } from "./start-run";

export const disclosureNoStore = { "cache-control": "private, no-store" } as const;

const statusByCode: Record<string, number> = {
  DATABASE_UNAVAILABLE: 503,
  DISCLOSURE_CASE_NOT_FOUND: 404,
  DISCLOSURE_RUN_NOT_FOUND: 404,
  DISCLOSURE_REPORT_MISSING: 409,
  DISCLOSURE_DOCUMENT_NOT_READY: 409,
  DISCLOSURE_RUN_IN_PROGRESS: 409,
  DISCLOSURE_MODEL_KEY_REQUIRED: 409,
  MODEL_SELECTION_NOT_FOUND: 409,
  BYOK_ROUTE_NOT_EXECUTABLE: 409,
  DISCLOSURE_FORBIDDEN: 403,
  MEMBERSHIP_REQUIRED: 403,
  VERIFIED_EMAIL_REQUIRED: 403,
  DISCLOSURE_EVIDENCE_XLSX_ONLY: 400,
  DISCLOSURE_EVIDENCE_NOT_FOUND: 404,
  DISCLOSURE_EVIDENCE_NOT_ACTIVE: 409,
  DISCLOSURE_EVIDENCE_EXPIRED: 410,
  DISCLOSURE_EVIDENCE_PATH_MISMATCH: 400,
  DISCLOSURE_EVIDENCE_OBJECT_MISSING: 409,
  DISCLOSURE_EVIDENCE_METADATA_MISMATCH: 400,
  CHECKLIST_NOT_FOUND: 404,
};

export function disclosureFailure(code: string, status?: number) {
  return NextResponse.json(
    { code },
    { status: status ?? statusByCode[code] ?? 500, headers: disclosureNoStore },
  );
}

export function disclosureErrorResponse(error: unknown, logTag: string) {
  const protectedResponse = requestProtectionResponse(error);
  if (protectedResponse) return protectedResponse;
  if (error instanceof z.ZodError) return disclosureFailure("INVALID_DISCLOSURE_REQUEST", 400);
  if (error instanceof AuthenticationRequiredError)
    return disclosureFailure("AUTHENTICATION_REQUIRED", 401);
  if (error instanceof AuthorizationDeniedError || error instanceof MembershipRequiredError)
    return disclosureFailure("ADMIN_REQUIRED", 403);
  if (error instanceof VerifiedEmailRequiredError)
    return disclosureFailure("VERIFIED_EMAIL_REQUIRED", 403);
  if (error instanceof DisclosureAccessError) return disclosureFailure(error.code);
  if (error instanceof DisclosureRunError) return disclosureFailure(error.code);
  if (error instanceof DisclosureEvidenceError) return disclosureFailure(error.code);
  if (error instanceof DisclosureReviewError) return disclosureFailure(error.code, error.status);
  if (error instanceof ChecklistError) {
    return NextResponse.json(
      { code: error.code, issues: error.issues },
      { status: error.status, headers: disclosureNoStore },
    );
  }
  if (error instanceof ChecklistTemplateError) return disclosureFailure(error.code, error.status);
  if (error instanceof CredentialValidationError || error instanceof TemporaryCredentialError) {
    return credentialErrorResponse(error, logTag);
  }
  console.error(`[${logTag}] failed`, error instanceof Error ? error.name : typeof error);
  return disclosureFailure("DISCLOSURE_REQUEST_FAILED", 500);
}
