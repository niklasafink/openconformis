import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteSavedCredential } from "@/server/ai/saved-credential-service";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
