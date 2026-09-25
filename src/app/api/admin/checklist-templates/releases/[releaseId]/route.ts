import { NextResponse } from "next/server";
import { z } from "zod";

import {
  archiveTemplateRelease,
  discardTemplateDraft,
  publishTemplateRelease,
  readTemplateDraftPreview,
} from "@/server/disclosure/checklist-templates";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ releaseId: string }> };

/** Die Positionen einer Version, für die Vorschau vor dem Veröffentlichen. */
export async function GET(_request: Request, context: Context) {
  try {
    const { releaseId } = await context.params;
    return NextResponse.json(
      { items: await readTemplateDraftPreview(releaseId) },
      { headers: disclosureNoStore },
    );
  } catch (error) {
    return disclosureErrorResponse(error, "admin-checklist-preview");
  }
}

const operationSchema = z.object({ operation: z.enum(["publish", "archive", "discard"]) });

/** Veröffentlichen oder Verwerfen eines Entwurfs, Archivieren einer Version. */
export async function POST(request: Request, context: Context) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 1_024);
    const { releaseId } = await context.params;
    const { operation } = operationSchema.parse(await request.json());
    const result =
      operation === "publish"
        ? await publishTemplateRelease(releaseId)
        : operation === "archive"
          ? await archiveTemplateRelease(releaseId)
          : await discardTemplateDraft(releaseId);
    return NextResponse.json(result, { headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "admin-checklist-release");
  }
}
