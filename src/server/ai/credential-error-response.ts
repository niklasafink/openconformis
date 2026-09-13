import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { CredentialValidationError } from "@/server/ai/credential-validation";
import { ModelProviderError } from "@/server/ai/structured-model";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";
import { AuthenticationRequiredError } from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { requestProtectionResponse } from "@/server/security/request-protection";

const serverConfigurationCodes = new Set([
  "BYOK_ENCRYPTION_NOT_CONFIGURED",
  "BYOK_ENCRYPTION_KEY_INVALID",
  "BYOK_KEY_VERSION_INVALID",
  "BYOK_SECRET_INVALID",
]);

function databaseErrorCode(error: unknown) {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = candidate?.cause?.code ?? candidate?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code) ? code : undefined;
}

/** Antwort auf einen Fehler beim Verbinden oder Speichern eines Schlüssels. */
export function credentialErrorResponse(error: unknown, logTag: string) {
  const protectedResponse = requestProtectionResponse(error);
  if (protectedResponse) return protectedResponse;
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
      ["BYOK_BINDING_NOT_FOUND", 404],
      ["BYOK_SAVED_CREDENTIAL_NOT_FOUND", 404],
      ["BYOK_INPUT_INVALID", 400],
      ["BYOK_TTL_INVALID", 503],
    ]).get(error.code);
    return NextResponse.json({ code: error.code }, { status: status ?? 500 });
  }
  if (error instanceof ModelProviderError) {
    console.error(`[${logTag}] provider route failed`, error.code);
    return NextResponse.json({ code: error.code }, { status: 503 });
  }
  if (error instanceof Error && serverConfigurationCodes.has(error.message)) {
    console.error(`[${logTag}] server configuration invalid`, error.message);
    return NextResponse.json({ code: error.message }, { status: 503 });
  }
  // Unbekannte Fehler behalten Fehlertyp und Datenbank-Code als Ursache.
  // Die Fehlermeldung selbst bleibt draußen: sie kann Abfrageparameter enthalten.
  const name = error instanceof Error ? error.name : typeof error;
  const databaseCode = databaseErrorCode(error);
  const code =
    databaseCode || /drizzle|postgres|neon/iu.test(name)
      ? "CREDENTIAL_STORAGE_FAILED"
      : "CREDENTIAL_CONNECTION_FAILED";
  const detail = [name, databaseCode].filter(Boolean).join(" ");
  console.error(`[${logTag}] connection failed`, code, detail);
  return NextResponse.json({ code, detail }, { status: 500 });
}
