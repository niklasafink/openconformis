import { NextResponse } from "next/server";

import { removeChecklistItem, saveChecklistItem } from "@/server/disclosure/checklists";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ checklistId: string; itemId: string }> };

/** Ändert eine Position einer eigenen Checkliste. */
export async function PATCH(request: Request, context: Context) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 32_768);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-checklist-edit",
      limit: 300,
      windowSeconds: 600,
    });
    const { checklistId, itemId } = await context.params;
    const result = await saveChecklistItem(checklistId, itemId, await request.json());
    return NextResponse.json(result, { headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-checklist-item-change");
  }
}

/** Entfernt eine Position samt Unterpositionen. */
export async function DELETE(request: Request, context: Context) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    const { checklistId, itemId } = await context.params;
    const result = await removeChecklistItem(checklistId, itemId);
    return NextResponse.json(result, { headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-checklist-item-remove");
  }
}
