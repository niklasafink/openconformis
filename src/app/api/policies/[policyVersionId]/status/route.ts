import { NextResponse } from "next/server";
import { z } from "zod";

import { getPolicyProcessingState } from "@/server/policies/upload-service";

export const runtime = "nodejs";

const paramsSchema = z.object({ policyVersionId: z.uuid() });
const querySchema = z.object({ draft: z.uuid() });

/** Fortschritt der Aufbereitung einer hochgeladenen Policy. */
export async function GET(
  request: Request,
  context: { params: Promise<{ policyVersionId: string }> },
) {
  try {
    const { policyVersionId } = await paramsSchema.parseAsync(await context.params);
    const { draft } = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    return NextResponse.json(await getPolicyProcessingState(policyVersionId, draft), {
      headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_REQUEST" }, { status: 400 });
    }
    const code = error instanceof Error ? error.message : "STATUS_FAILED";
    const notFound = code === "DRAFT_NOT_FOUND" || code === "UPLOAD_NOT_FOUND";
    return NextResponse.json({ code }, { status: notFound ? 404 : 500 });
  }
}
