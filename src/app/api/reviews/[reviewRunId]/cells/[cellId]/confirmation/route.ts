import { NextResponse } from "next/server";
import { z } from "zod";

import { reviewErrorResponse, reviewFailure, reviewNoStore } from "@/server/review/review-http";
import { setReviewCellConfirmation } from "@/server/review/review-actions";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";

const paramsSchema = z.object({ reviewRunId: z.uuid(), cellId: z.uuid() });
const inputSchema = z.object({ confirmed: z.boolean() }).strict();

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
    const result = await setReviewCellConfirmation({ ...params, ...input });
    if (!result.ok) return reviewFailure(result.code);
    return NextResponse.json(
      { confirmed: result.confirmed, confirmedAt: result.confirmedAt },
      { headers: reviewNoStore },
    );
  } catch (error) {
    return reviewErrorResponse(error, "review-confirmation");
  }
}
