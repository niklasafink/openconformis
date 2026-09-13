import { NextResponse } from "next/server";
import { z } from "zod";

import { AnalysisCancelError, cancelOwnedAnalysis } from "@/server/analyses/cancel-analysis";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import {
  requireAuthenticatedSessionUser,
  VerifiedEmailRequiredError,
} from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ analysisId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }
  try {
    const user = await requireAuthenticatedSessionUser();
    const analysisId = z.uuid().parse((await context.params).analysisId);
    const result = await cancelOwnedAnalysis({ analysisId, ownerUserId: user.id });
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_ANALYSIS_ID" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (error instanceof VerifiedEmailRequiredError) {
      return NextResponse.json({ code: "VERIFIED_EMAIL_REQUIRED" }, { status: 403 });
    }
    if (error instanceof AnalysisCancelError) {
      return NextResponse.json({ code: error.code }, { status: 404 });
    }
    console.error("[analysis-cancel] failed", error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ code: "ANALYSIS_CANCEL_FAILED" }, { status: 500 });
  }
}
