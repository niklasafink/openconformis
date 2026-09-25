import { NextResponse } from "next/server";

import { importTemplateDraft } from "@/server/disclosure/checklist-templates";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Liest die hochgeladene Excel-Datei, validiert sie und legt einen Entwurf an. Fehler
 * kommen als Liste mit Zeile und Code zurück (422), die Datei wird immer gelöscht.
 */
export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 4_096);
    await enforceRequestRateLimit(request, {
      bucket: "admin-checklist-import",
      limit: 30,
      windowSeconds: 600,
    });
    const result = await importTemplateDraft(await request.json());
    return NextResponse.json(result, {
      status: result.ok ? 201 : 422,
      headers: disclosureNoStore,
    });
  } catch (error) {
    return disclosureErrorResponse(error, "admin-checklist-import");
  }
}
