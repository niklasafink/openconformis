import { NextResponse } from "next/server";
import { z } from "zod";

import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { prepareDisclosureModel } from "@/server/disclosure/model-route";
import { disclosureRunStartSchema, startDisclosureRun } from "@/server/disclosure/start-run";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Startet den Plausicheck einer Prüfung. `modelProfileId` ist optional: ohne Modell
 * laufen die deterministischen Prüfungen allein. Ein doppelter Aufruf übernimmt den
 * offenen Lauf mit denselben eingefrorenen Eingaben (`reused: true`).
 */
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    assertRequestSize(request, 8_192);
    await enforceRequestRateLimit(request, {
      bucket: "disclosure-run-start",
      limit: 20,
      windowSeconds: 3600,
    });
    const caseId = z.uuid().parse((await context.params).caseId);
    const body = await request.json().catch(() => ({}));
    const result = await startDisclosureRun(caseId, disclosureRunStartSchema.parse(body ?? {}), {
      prepareModel: prepareDisclosureModel,
    });
    return NextResponse.json(result, {
      status: result.reused ? 200 : 202,
      headers: disclosureNoStore,
    });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-run-start");
  }
}
