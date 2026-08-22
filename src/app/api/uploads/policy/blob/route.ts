import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizePolicyBlobUpload } from "@/server/policies/upload-service";

export const runtime = "nodejs";

const payloadSchema = z.object({ intentId: z.uuid(), draftId: z.uuid() });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = payloadSchema.parse(JSON.parse(clientPayload ?? "null"));
        const authorization = await authorizePolicyBlobUpload({ ...payload, pathname });
        return {
          allowedContentTypes: [authorization.contentType],
          maximumSizeInBytes: authorization.maximumSizeInBytes,
          validUntil: authorization.validUntil.getTime(),
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          tokenPayload: JSON.stringify({ intentId: authorization.intentId }),
        };
      },
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ code: "BLOB_UPLOAD_FAILED" }, { status: 400 });
  }
}
