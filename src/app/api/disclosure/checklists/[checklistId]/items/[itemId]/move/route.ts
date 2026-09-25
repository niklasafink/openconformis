import { NextResponse } from "next/server";
import { z } from "zod";

import { moveChecklistItem } from "@/server/disclosure/checklists";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verschiebt eine Position unter ihren Geschwistern nach oben oder unten. */
export async function POST(
  request: Request,
  context: { params: Promise<{ checklistId: string; itemId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 1_024);
    const { checklistId, itemId } = await context.params;
    const { direction } = z
      .object({ direction: z.enum(["up", "down"]) })
      .parse(await request.json());
    return NextResponse.json(await moveChecklistItem(checklistId, itemId, direction), {
      headers: disclosureNoStore,
    });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-checklist-item-move");
  }
}
