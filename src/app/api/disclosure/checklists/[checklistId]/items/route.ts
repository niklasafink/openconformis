import { NextResponse } from "next/server";

import { saveChecklistItem } from "@/server/disclosure/checklists";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fügt einer eigenen Checkliste eine Position hinzu. */
export async function POST(
  request: Request,
  context: { params: Promise<{ checklistId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 32_768);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-checklist-edit",
      limit: 300,
      windowSeconds: 600,
    });
    const { checklistId } = await context.params;
    const result = await saveChecklistItem(checklistId, null, await request.json());
    return NextResponse.json(result, { status: 201, headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-checklist-item-add");
  }
}
