import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnedAnalysisDocumentBlocks } from "@/server/analyses/read-analysis";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError, requireVerifiedSessionUser } from "@/server/auth/session-user";

export const runtime = "nodejs";

const paramsSchema = z.object({ analysisId: z.uuid() });

export async function GET(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  try {
    const [{ analysisId }, user] = await Promise.all([
      paramsSchema.parseAsync(await context.params),
      requireVerifiedSessionUser(),
    ]);
    const result = await getOwnedAnalysisDocumentBlocks({ analysisId, ownerUserId: user.id });
    if (!result) return NextResponse.json({ code: "ANALYSIS_NOT_FOUND" }, { status: 404 });
    return NextResponse.json(result, {
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
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
    return NextResponse.json({ code: "DOCUMENT_FAILED" }, { status: 500 });
  }
}
