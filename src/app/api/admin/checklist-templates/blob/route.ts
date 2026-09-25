import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { authorizeTemplateBlobUpload } from "@/server/disclosure/checklist-templates";

export const runtime = "nodejs";

/** Token für den Direktupload einer Excel-Vorlage; nur Import-Pfad, Typ und Größe. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const authorization = await authorizeTemplateBlobUpload(pathname);
        return {
          allowedContentTypes: [authorization.contentType],
          maximumSizeInBytes: authorization.maximumSizeInBytes,
          validUntil: authorization.validUntil.getTime(),
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        };
      },
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ code: "BLOB_UPLOAD_FAILED" }, { status: 400 });
  }
}
