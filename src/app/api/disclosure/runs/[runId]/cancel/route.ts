import { NextResponse } from "next/server";

import { cancelDisclosureRun } from "@/server/disclosure/cancel-run";
import {
  disclosureErrorResponse,
  disclosureFailure,
  disclosureNoStore,
} from "@/server/disclosure/disclosure-http";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** „Analyse stoppen“: beendet einen wartenden oder laufenden Plausicheck-Lauf. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!hasTrustedApplicationOrigin(request)) return disclosureFailure("UNTRUSTED_ORIGIN", 403);
  try {
    const { runId } = await context.params;
    const result = await cancelDisclosureRun(runId);
    if (!result.ok) return disclosureFailure(result.code);
    return NextResponse.json(
      { runId, status: result.status, changed: result.changed },
      { headers: disclosureNoStore },
    );
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-run-cancel");
  }
}
