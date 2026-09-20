import "server-only";

import { FatalError, RetryableError } from "workflow";

import { ProviderRouteConfigurationError } from "@/server/ai/provider-routing";
import { ModelProviderError } from "@/server/ai/structured-model";
import { TemporaryCredentialError } from "@/server/ai/temporary-credential-service";

import { ReviewRouteError } from "./review-provider";

/**
 * Ein Anbieterfehler, der beim nächsten Versuch genauso ausfällt — ein ungültiger
 * Schlüssel, eine gesperrte Route, eine fehlerhafte Anfrage —, endet den Kind-Lauf mit
 * `FatalError`. Ohne das wiederholte der Workflow ihn dreimal und meldete am Ende „alle
 * Versuche verbraucht", was die eigentliche Ursache verdeckte.
 *
 * Eine Drosselung dagegen wartet genau so lange, wie der Anbieter es verlangt
 * (`Retry-After`), statt mit eigener Wiederholungslogik zu raten.
 */
export function reviewTerminalIfPermanent(error: unknown): never {
  if (error instanceof ModelProviderError && error.code === "PROVIDER_RATE_LIMITED") {
    throw new RetryableError(error.message, {
      retryAfter: Math.max(1, error.retryAfterSeconds ?? 5) * 1000,
    });
  }
  if (
    error instanceof TemporaryCredentialError ||
    error instanceof ProviderRouteConfigurationError ||
    error instanceof ReviewRouteError ||
    (error instanceof ModelProviderError && !error.retryable)
  ) {
    throw new FatalError(error.message);
  }
  throw error;
}
