import { NextResponse } from "next/server";
import { z } from "zod";

import { CredentialValidationError } from "@/server/ai/credential-validation";
import {
  createTemporaryCredential,
  listActiveTemporaryCredentials,
  TemporaryCredentialError,
} from "@/server/ai/temporary-credential-service";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z
  .object({
    provider: z.enum(["openrouter", "requesty", "anthropic", "google", "openai"]),
    purpose: z.enum(["analysis", "chat"]),
    bindingId: z.uuid().optional(),
    requiredModelId: z.string().trim().min(1).max(300),
    apiKey: z.string().min(8).max(20_000),
    privacyAttestationAccepted: z.boolean().optional(),
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

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ code: "INVALID_CREDENTIAL_INPUT" }, { status: 400 });
  }
  if (error instanceof AuthenticationRequiredError) {
    return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }
  if (error instanceof VerifiedEmailRequiredError) {
    return NextResponse.json({ code: "VERIFIED_EMAIL_REQUIRED" }, { status: 403 });
  }
  if (error instanceof CredentialValidationError) {
    const status = error.code === "PROVIDER_UNAVAILABLE" ? 503 : 422;
    return NextResponse.json({ code: error.code, retryable: error.retryable }, { status });
  }
  if (error instanceof TemporaryCredentialError) {
    const status = new Map<string, number>([
      ["BYOK_PROVIDER_DISABLED", 409],
      ["BYOK_PRIVACY_ROUTE_UNAVAILABLE", 409],
      ["BYOK_PRIVACY_ATTESTATION_REQUIRED", 409],
      ["BYOK_BINDING_NOT_FOUND", 404],
      ["BYOK_INPUT_INVALID", 400],
      ["BYOK_TTL_INVALID", 503],
    ]).get(error.code);
    return NextResponse.json({ code: error.code }, { status: status ?? 500 });
  }
  return NextResponse.json({ code: "CREDENTIAL_CONNECTION_FAILED" }, { status: 500 });
}

export async function POST(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }

  try {
    const input = inputSchema.parse(await request.json());
    const credential = await createTemporaryCredential({
      provider: input.provider,
      purpose: input.purpose,
      bindingId: input.bindingId ?? "",
      requiredModelId: input.requiredModelId,
      secret: input.apiKey,
      privacyAttestationAccepted: input.privacyAttestationAccepted,
    });
    return NextResponse.json(credential, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const purpose = z
      .enum(["analysis", "chat"])
      .parse(new URL(request.url).searchParams.get("purpose"));
    const credentials = await listActiveTemporaryCredentials(purpose);
    return NextResponse.json(
      { credentials },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
