import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { resolveDisclosureActor } from "@/server/disclosure/actor";
import { disclosureErrorResponse, disclosureFailure } from "@/server/disclosure/disclosure-http";
import { readDisclosureExport } from "@/server/disclosure/export-run";
import {
  buildDisclosureXlsx,
  createDisclosureExportFilename,
} from "@/server/exports/disclosure-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumWorkbookBytes = 16 * 1024 * 1024;

/**
 * Excel-Export der Feststellungen eines beendeten Plausicheck-Laufs, mit übernommenem
 * Wert, Freigabe und Verlauf. Ein laufender Lauf lässt sich nicht exportieren.
 */
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "de";
    const actor = await resolveDisclosureActor();
    const data = await readDisclosureExport(runId, locale);
    if (!data) return disclosureFailure("DISCLOSURE_RUN_NOT_FOUND");
    if (data === "open") return disclosureFailure("DISCLOSURE_RUN_IN_PROGRESS", 409);

    const workbook = await buildDisclosureXlsx(data);
    if (workbook.byteLength > maximumWorkbookBytes) {
      return disclosureFailure("DISCLOSURE_EXPORT_TOO_LARGE", 413);
    }
    await appendAuditEvent(db, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "disclosure.exported",
      targetType: "disclosure_run",
      targetId: data.runId,
      metadata: { format: "xlsx", findingCount: data.findings.length },
    });

    const filename = createDisclosureExportFilename(data);
    const body = new ArrayBuffer(workbook.byteLength);
    new Uint8Array(body).set(workbook);
    return new Response(body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "content-length": String(workbook.byteLength),
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return disclosureErrorResponse(error, "disclosure-export");
  }
}
