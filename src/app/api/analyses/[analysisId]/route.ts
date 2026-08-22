import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnedAnalysisStatus } from "@/server/analyses/read-analysis";
import { requestAnalysisDeletion } from "@/server/analyses/delete-analysis";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { requireVerifiedSessionUser, VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisIdSchema = z.uuid();

export async function GET(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  try {
    const user = await requireVerifiedSessionUser();
    const { analysisId: rawAnalysisId } = await context.params;
    const analysisId = analysisIdSchema.parse(rawAnalysisId);
    const analysis = await getOwnedAnalysisStatus({ analysisId, ownerUserId: user.id });

    if (!analysis) {
      return NextResponse.json({ code: "ANALYSIS_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: analysis.id,
        status: analysis.status,
        stage: analysis.stage,
        progressPercent: analysis.progressPercent,
        updatedAt: analysis.updatedAt.toISOString(),
        completedAt: analysis.completedAt?.toISOString(),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
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
    return NextResponse.json({ code: "ANALYSIS_STATUS_FAILED" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ analysisId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request))
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  try {
    const { analysisId } = await context.params;
    return NextResponse.json(await requestAnalysisDeletion(analysisId), {
      status: 202,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ code: "INVALID_ANALYSIS_ID" }, { status: 400 });
    if (error instanceof AuthenticationRequiredError)
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    if (error instanceof Error && error.message === "ANALYSIS_NOT_FOUND")
      return NextResponse.json({ code: "ANALYSIS_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ code: "ANALYSIS_DELETION_FAILED" }, { status: 500 });
  }
}
