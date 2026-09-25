import { FatalError } from "workflow";

import { ProviderRouteConfigurationError } from "@/server/ai/provider-routing";
import { ModelProviderError } from "@/server/ai/structured-model";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";

/**
 * Nur in Workflow-Schritten der Offenlegungspflicht: Fehler, die eine Wiederholung nicht
 * behebt, enden den Schritt sofort mit ihrer Ursache. Die Regeln für den Workflow-Körper
 * selbst stehen ohne Server-Importe in `src/workflows/disclosure-errors.ts`.
 */

const permanentCodes = new Set([
  "DISCLOSURE_RECOGNITION_CHANGED",
  "DISCLOSURE_REPORT_MISSING",
  "DISCLOSURE_CREDENTIAL_EXPIRED",
]);

export function terminalIfPermanent(error: unknown): never {
  if (error instanceof TemporaryCredentialError) throw new FatalError(error.code);
  if (error instanceof ProviderRouteConfigurationError) {
    throw new FatalError("PROVIDER_ROUTE_INVALID");
  }
  if (error instanceof ModelProviderError && !error.retryable) {
    throw new FatalError(`${error.code}: ${error.detail}`.slice(0, 700));
  }
  if (error instanceof Error && permanentCodes.has(error.message)) {
    throw new FatalError(error.message);
  }
  throw error;
}
