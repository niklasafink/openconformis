import { NextResponse } from "next/server";
import { z } from "zod";

import { aiRouteProviderSchema } from "@/domain/ai/provider";
import { credentialErrorResponse } from "@/server/ai/credential-error-response";
import { deleteSavedCredential } from "@/server/ai/saved-credential-service";
import { verifyAndSaveUserCredential } from "@/server/ai/temporary-credential-service";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { assertRequestSize, enforceRequestRateLimit } from "@/server/security/request-protection";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveInputSchema = z.object({
  provider: aiRouteProviderSchema,
  requiredModelId: z.string().trim().min(1).max(300),
  apiKey: z.string().trim().min(8).max(20_000),
});

/**
 * Fügt einen Schlüssel hinzu: Der Anbieter bestätigt ihn für das gewählte Modell,
 * danach wird er verschlüsselt gespeichert. Es startet dabei keine Analyse.
 */
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
    const input = saveInputSchema.parse(await request.json());
    const saved = await verifyAndSaveUserCredential({
      provider: input.provider,
      requiredModelId: input.requiredModelId,
      secret: input.apiKey,
    });
    return NextResponse.json(saved, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return credentialErrorResponse(error, "ai-credentials/saved");
  }
}

/** Entfernt den gespeicherten Schlüssel des Nutzers für einen Anbieter. */
export async function DELETE(request: Request) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }

  try {
    const result = await deleteSavedCredential(
      new URL(request.url).searchParams.get("provider") ?? "",
    );
    return NextResponse.json(result, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_PROVIDER" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (error instanceof VerifiedEmailRequiredError) {
      return NextResponse.json({ code: "VERIFIED_EMAIL_REQUIRED" }, { status: 403 });
    }
    console.error(
      "[ai-credentials/saved] delete failed",
      error instanceof Error ? error.name : typeof error,
    );
    return NextResponse.json({ code: "SAVED_CREDENTIAL_DELETE_FAILED" }, { status: 500 });
  }
}
