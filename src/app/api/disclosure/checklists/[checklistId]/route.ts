import { NextResponse } from "next/server";
import { z } from "zod";

import { renameChecklist } from "@/server/disclosure/checklists";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Benennt eine eigene Checkliste um. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ checklistId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 4_096);
    const { checklistId } = await context.params;
    const body = z.object({ title: z.unknown() }).parse(await request.json());
    return NextResponse.json(await renameChecklist(checklistId, body.title), {
      headers: disclosureNoStore,
    });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-checklist-rename");
  }
}
