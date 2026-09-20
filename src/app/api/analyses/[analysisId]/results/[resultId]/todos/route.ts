import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AnalysisResultNotFoundError,
  AnalysisTodoNotFoundError,
  setAnalysisResultTodo,
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
    index: z.number().int().min(0).max(11),
    done: z.boolean(),
    // „evidence" sind die fehlenden Nachweise der Bewertung, „actions" die
    // Maßnahmen des Abschlusstexts im Profil „Finanzinstitut".
    list: z.enum(["evidence", "actions"]).optional(),
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
    const result = await setAnalysisResultTodo({ analysisId, resultId, ...input });

    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_TODO" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (
      error instanceof VerifiedEmailRequiredError ||
      error instanceof MembershipRequiredError ||
      error instanceof AuthorizationDeniedError
    ) {
      return NextResponse.json({ code: "TODO_FORBIDDEN" }, { status: 403 });
    }
    if (
      error instanceof AnalysisResultNotFoundError ||
      error instanceof AnalysisTodoNotFoundError
    ) {
      return NextResponse.json({ code: "ANALYSIS_TODO_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ code: "TODO_FAILED" }, { status: 500 });
  }
}
