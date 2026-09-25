import { NextResponse } from "next/server";

import { listAdminChecklistTemplates } from "@/server/disclosure/checklist-templates";
import { disclosureErrorResponse, disclosureNoStore } from "@/server/disclosure/disclosure-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vorlagen der Vollständigkeitsprüfung mit Versionen; nur Catalogue-Administratoren. */
export async function GET() {
  try {
    return NextResponse.json(
      { templates: await listAdminChecklistTemplates() },
      { headers: disclosureNoStore },
    );
  } catch (error) {
    return disclosureErrorResponse(error, "admin-checklist-templates");
  }
}
