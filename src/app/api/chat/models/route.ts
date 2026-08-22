import { NextResponse } from "next/server";

import { getChatModelCatalogue, ModelCatalogueError } from "@/server/ai/model-catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const catalogue = await getChatModelCatalogue();
    return NextResponse.json(catalogue, {
      headers: { "cache-control": "private, max-age=0, must-revalidate" },
    });
  } catch (error) {
    const code = error instanceof ModelCatalogueError ? error.code : "MODEL_CATALOGUE_UNAVAILABLE";
    return NextResponse.json({ code }, { status: 503 });
  }
}
