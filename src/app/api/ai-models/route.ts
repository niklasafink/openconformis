import { NextResponse } from "next/server";

import { getAnalysisModelCatalogue, ModelCatalogueError } from "@/server/ai/model-catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalogue = await getAnalysisModelCatalogue();
    return NextResponse.json(catalogue, {
      headers: { "cache-control": "public, max-age=300, stale-while-revalidate=21600" },
    });
  } catch (error) {
    const code = error instanceof ModelCatalogueError ? error.code : "MODEL_CATALOGUE_FAILED";
    return NextResponse.json({ code }, { status: 503 });
  }
}
