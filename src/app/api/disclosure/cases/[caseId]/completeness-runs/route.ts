import { NextResponse } from "next/server";
import { z } from "zod";

import { startCompletenessRun } from "@/server/disclosure/completeness-run";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { prepareDisclosureModel } from "@/server/disclosure/model-route";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Startet die Vollständigkeitsprüfung mit gewählter Checkliste und Modell. Ein doppelter
 * Aufruf mit denselben eingefrorenen Eingaben übernimmt den offenen Lauf (`reused: true`).
 */
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 8_192);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-completeness-start",
      limit: 20,
      windowSeconds: 3600,
    });
    const caseId = z.uuid().parse((await context.params).caseId);
    const result = await startCompletenessRun(caseId, await request.json(), {
      prepareModel: prepareDisclosureModel,
    });
    return NextResponse.json(result, {
      status: result.reused ? 200 : 202,
      headers: disclosureNoStore,
    });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-completeness-start");
  }
}
