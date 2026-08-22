import { NextResponse } from "next/server";
import { z } from "zod";

import {
  revokeTemporaryCredential,
  TemporaryCredentialError,
} from "@/server/ai/temporary-credential-service";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { hasTrustedApplicationOrigin } from "@/server/security/trusted-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ credentialId: string }> },
) {
  if (!hasTrustedApplicationOrigin(request)) {
    return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  }

  try {
    const { credentialId: rawCredentialId } = await context.params;
    const credentialId = z.uuid().parse(rawCredentialId);
    const result = await revokeTemporaryCredential(credentialId);
    return NextResponse.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ code: "INVALID_CREDENTIAL_ID" }, { status: 400 });
    }
    if (error instanceof AuthenticationRequiredError) {
      return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
    }
    if (error instanceof VerifiedEmailRequiredError) {
      return NextResponse.json({ code: "VERIFIED_EMAIL_REQUIRED" }, { status: 403 });
    }
    if (error instanceof TemporaryCredentialError) {
      const status = error.code === "BYOK_CREDENTIAL_NOT_FOUND" ? 404 : 500;
      return NextResponse.json({ code: error.code }, { status });
    }
    return NextResponse.json({ code: "CREDENTIAL_REVOCATION_FAILED" }, { status: 500 });
  }
}
