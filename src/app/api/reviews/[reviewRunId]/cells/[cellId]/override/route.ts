import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";
import {
  reviewCellOverrideAnswerSchema,
  setReviewCellOverride,
} from "@/server/review/review-actions";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

const paramsSchema = z.object({ reviewRunId: z.uuid(), cellId: z.uuid() });
const inputSchema = z
  .object({
    answer: reviewCellOverrideAnswerSchema,
    reason: z.string().trim().min(8).max(2_000),
  })
  .strict();

/** Begründetes Überschreiben: legt eine neue Zeile an, die KI-Antwort bleibt unverändert. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ reviewRunId: string; cellId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) return reviewFailure("UNTRUSTED_ORIGIN", 403);
  try {
    const [params, input] = await Promise.all([
      paramsSchema.parseAsync(await context.params),
      inputSchema.parseAsync(await request.json()),
    ]);
    const result = await setReviewCellOverride({ ...params, ...input });
    if (!result.ok) return reviewFailure(result.code);
    return NextResponse.json(
      { overrideId: result.overrideId, confirmationInvalidated: result.confirmationInvalidated },
      { headers: reviewNoStore },
    );
  } catch (error) {
    return reviewErrorResponse(error, "review-override");
  }
}
