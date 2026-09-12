import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { renderDocxToHtml } from "@/server/policies/docx-html";
import {
  OriginalDocumentError,
  loadOriginalPolicyDocument,
} from "@/server/policies/original-document";

export const runtime = "nodejs";

const paramsSchema = z.object({ policyVersionId: z.uuid() });

/**
 * Word-Dateien kann der Browser nicht selbst darstellen. Die Umwandlung läuft
 * deshalb auf dem Server und liefert bereinigtes HTML derselben Datei.
 */
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
    if (document.kind !== "docx") {
      return NextResponse.json({ code: "UNSUPPORTED_TYPE" }, { status: 415 });
    }

    return NextResponse.json(
      { html: await renderDocxToHtml(document.bytes) },
      {
        headers: {
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_POLICY_VERSION_ID" }, { status: 400 });
    }
    if (error instanceof OriginalDocumentError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 410;
      return NextResponse.json({ code: error.code }, { status });
    }
    return NextResponse.json({ code: "ORIGINAL_FAILED" }, { status: 500 });
  }
}
