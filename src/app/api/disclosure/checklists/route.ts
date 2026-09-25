import { NextResponse } from "next/server";

import { createChecklistFromTemplate } from "@/server/disclosure/checklists";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legt eine eigene Checkliste als Kopie einer veröffentlichten Vorlagenversion an. */
export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 4_096);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-checklist-create",
      limit: 30,
      windowSeconds: 3600,
    });
    const result = await createChecklistFromTemplate(await request.json());
    return NextResponse.json(result, { status: 201, headers: disclosureNoStore });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-checklist-create");
  }
}
