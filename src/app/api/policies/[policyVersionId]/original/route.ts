import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import {
  OriginalDocumentError,
  loadOriginalPolicyDocument,
} from "@/server/policies/original-document";

export const runtime = "nodejs";

const paramsSchema = z.object({ policyVersionId: z.uuid() });

function failure(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ code: "INVALID_POLICY_VERSION_ID" }, { status: 400 });
  }
  if (error instanceof OriginalDocumentError) {
    const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 410;
    return NextResponse.json({ code: error.code }, { status });
  }
  return NextResponse.json({ code: "ORIGINAL_FAILED" }, { status: 500 });
}

/** Liefert die hochgeladene Datei selbst — nur an ihren Eigentümer, nie im Cache. */
export async function GET(
  request: Request,
  context: { params: Promise<{ policyVersionId: string }> },
) {
  try {
    const { policyVersionId } = await paramsSchema.parseAsync(await context.params);
    const user = await requireAuthenticatedSessionUser().catch(() => null);
    const draftId = new URL(request.url).searchParams.get("draft") ?? undefined;

    const document = await loadOriginalPolicyDocument({
      policyVersionId,
      ownerUserId: user?.id ?? null,
      draftId,
    });

    return new NextResponse(new Uint8Array(document.bytes), {
      headers: {
        "content-type": document.mimeType,
        "content-length": String(document.bytes.byteLength),
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
