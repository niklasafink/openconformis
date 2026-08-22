import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnedAnalysisExportData } from "@/server/analyses/read-analysis";
import { appendAuditEvent } from "@/server/audit/event";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { requireVerifiedSessionUser, VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { db } from "@/server/db/client";
import { buildAnalysisXlsx, createAnalysisExportFilename } from "@/server/exports/analysis-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const analysisIdSchema = z.uuid();
const maximumWorkbookBytes = 16 * 1024 * 1024;

export async function GET(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  try {
    const user = await requireVerifiedSessionUser();
    const { analysisId: rawAnalysisId } = await context.params;
    const analysisId = analysisIdSchema.parse(rawAnalysisId);
    const analysis = await getOwnedAnalysisExportData({ analysisId, ownerUserId: user.id });

    if (!analysis) {
      return NextResponse.json({ code: "ANALYSIS_NOT_FOUND" }, { status: 404 });
    }
    if (analysis.status !== "completed") {
      return NextResponse.json({ code: "ANALYSIS_NOT_COMPLETED" }, { status: 409 });
    }

    const workbook = await buildAnalysisXlsx(analysis);
    if (workbook.byteLength > maximumWorkbookBytes) {
      return NextResponse.json({ code: "ANALYSIS_EXPORT_TOO_LARGE" }, { status: 413 });
    }

    await appendAuditEvent(db, {
      organizationId: analysis.organizationId,
      actorUserId: user.id,
      action: "analysis.exported",
      targetType: "analysis",
      targetId: analysis.id,
      metadata: {
        format: "xlsx",
        itemCount: analysis.items.length,
        citationCount: analysis.items.reduce((count, item) => count + item.evidence.length, 0),
      },
    });

    const filename = createAnalysisExportFilename(analysis);
    const responseBody = new ArrayBuffer(workbook.byteLength);
    new Uint8Array(responseBody).set(workbook);
    return new Response(responseBody, {
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
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_ANALYSIS_ID" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (error instanceof VerifiedEmailRequiredError) {
      return NextResponse.json({ code: "VERIFIED_EMAIL_REQUIRED" }, { status: 403 });
    }
    return NextResponse.json({ code: "ANALYSIS_EXPORT_FAILED" }, { status: 500 });
  }
}
