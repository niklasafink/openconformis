import { NextResponse } from "next/server";
import { z } from "zod";
import { aiCredentialPurposeSchema, aiRouteProviderSchema } from "@/domain/ai/provider";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";

import { credentialErrorResponse } from "@/server/ai/credential-error-response";
import {
  createTemporaryCredential,
  listActiveTemporaryCredentials,
} from "@/server/ai/temporary-credential-service";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z
  .object({
    provider: aiRouteProviderSchema,
    purpose: aiCredentialPurposeSchema,
    bindingId: z.uuid().optional(),
    requiredModelId: z.string().trim().min(1).max(300),
    /** Ohne Schlüssel nutzt der Server den gespeicherten Schlüssel des Nutzers. */
    apiKey: z.string().trim().min(8).max(20_000).optional(),
  })
  .superRefine((input, context) => {
    if (input.purpose === "analysis" && !input.bindingId) {
      context.addIssue({
        code: "custom",
        path: ["bindingId"],
        message: "An analysis draft is required.",
      });
    }
    if (input.purpose === "chat" && input.bindingId) {
      context.addIssue({
        code: "custom",
        path: ["bindingId"],
        message: "Chat credentials are bound by the server.",
      });
    }
  });

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }

  try {
    assertRequestSize(request, 131_072);
    await enforceRequestRateLimit(request, {
      bucket: "credential-connect",
      limit: 30,
      windowSeconds: 3600,
    });
    const input = inputSchema.parse(await request.json());
    const credential = await createTemporaryCredential({
      provider: input.provider,
      purpose: input.purpose,
      bindingId: input.bindingId ?? "",
      requiredModelId: input.requiredModelId,
      secret: input.apiKey,
    });
    return NextResponse.json(credential, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return credentialErrorResponse(error, "ai-credentials");
  }
}

export async function GET(request: Request) {
  try {
    const purpose = aiCredentialPurposeSchema.parse(
      new URL(request.url).searchParams.get("purpose"),
    );
    const credentials = await listActiveTemporaryCredentials(purpose);
    return NextResponse.json(
      { credentials },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return credentialErrorResponse(error, "ai-credentials");
  }
}
