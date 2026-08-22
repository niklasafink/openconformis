import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AnalysisNotCompletedError,
  AnalysisResultNotFoundError,
  setAnalysisResultOverride,
} from "@/server/analyses/review-analysis";
import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  MembershipRequiredError,
} from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

const paramsSchema = z.object({ analysisId: z.uuid(), resultId: z.uuid() });
const inputSchema = z
  .object({
    status: z.enum([
      "fulfilled",
      "partially_fulfilled",
      "not_fulfilled",
      "not_applicable",
      "no_assessment_possible",
    ]),
    reason: z.string().trim().min(8).max(2_000),
  })
  .strict();

export async function PUT(
  request: Request,
  context: { params: Promise<{ analysisId: string; resultId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }

  try {
    const [{ analysisId, resultId }, input] = await Promise.all([
      paramsSchema.parseAsync(await context.params),
      inputSchema.parseAsync(await request.json()),
    ]);
    const result = await setAnalysisResultOverride({ analysisId, resultId, ...input });

    return NextResponse.json(
      {
        status: result.status,
        override: {
          id: result.id,
          status: result.status,
          reason: result.reason,
          createdAt: result.createdAt.toISOString(),
        },
        confirmationInvalidated: result.confirmationInvalidated,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_OVERRIDE" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (
      error instanceof VerifiedEmailRequiredError ||
      error instanceof MembershipRequiredError ||
      error instanceof AuthorizationDeniedError
    ) {
      return NextResponse.json({ code: "OVERRIDE_FORBIDDEN" }, { status: 403 });
    }
    if (error instanceof AnalysisResultNotFoundError) {
      return NextResponse.json({ code: "ANALYSIS_RESULT_NOT_FOUND" }, { status: 404 });
    }
    if (error instanceof AnalysisNotCompletedError) {
      return NextResponse.json({ code: "ANALYSIS_NOT_COMPLETED" }, { status: 409 });
    }
    return NextResponse.json({ code: "OVERRIDE_FAILED" }, { status: 500 });
  }
}
