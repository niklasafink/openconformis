import "server-only";

import { aiRouteProviderSchema } from "@/domain/ai/provider";
import { systemOneModelId } from "@/domain/ai/system-one";
import {
  getAnalysisProviderConfiguration,
  requestProviderStructured,
} from "@/server/ai/provider-routing";
import type { StructuredModelRequest } from "@/server/ai/structured-model";
import {
  TemporaryCredentialError,
  withTemporaryCredential,
} from "@/server/ai/temporary-credential-service";

/**
 * Die beiden Schlüssel eines Prüflaufs.
 *
 * Ein Lauf hält zwei kurzlebige Credentials, beide an dieselbe `bindingId` — die
 * Lauf-ID — gebunden, aber an **verschiedene** Zwecke. Ein einziger Zweck reichte
 * nicht: der aktive Schlüssel ist über
 * `(owner, session, provider, purpose, binding)` eindeutig, und wer versehentlich
 * denselben Anbieter für Routing und Eskalation wählt, brächte beide zur Kollision.
 *
 * Gelöscht werden sie ausschliesslich im Abschluss des **Eltern**-Laufs. Räumte ein
 * Kind auf, zöge das erste fertige Kind den anderen neunundvierzig den Schlüssel weg.
 */

export type ReviewCredentialBinding = {
  id: string;
  ownerUserId: string;
  routingProvider: string;
  escalationProvider: string;
  routingCredentialId: string | null;
  escalationCredentialId: string | null;
  providerModelId: string;
};

export class ReviewRouteError extends Error {
  constructor(public readonly code: "REVIEW_ROUTE_UNSUPPORTED" | "REVIEW_CREDENTIAL_MISSING") {
    super(code);
    this.name = "ReviewRouteError";
  }
}

/** Führt `use` mit dem entschlüsselten Routing-Schlüssel aus. Nie länger als nötig. */
export function withRoutingKey<T>(
  run: ReviewCredentialBinding,
  use: (apiKey: string) => Promise<T>,
) {
  if (!run.routingCredentialId) throw new ReviewRouteError("REVIEW_CREDENTIAL_MISSING");
  const provider = aiRouteProviderSchema.safeParse(run.routingProvider);
  if (!provider.success) throw new ReviewRouteError("REVIEW_ROUTE_UNSUPPORTED");
  return withTemporaryCredential(
    {
      credentialId: run.routingCredentialId,
      ownerUserId: run.ownerUserId,
      provider: provider.data,
      purpose: "review_routing",
      bindingId: run.id,
      requiredModelId: provider.data === "typesafe" ? systemOneModelId : run.providerModelId,
    },
    use,
  );
}

/** Ein strukturierter Aufruf des grossen Modells für Eskalation oder Modellmodus. */
export async function requestStructuredForReview<T>(
  run: ReviewCredentialBinding,
  request: Omit<
    StructuredModelRequest<T>,
    "apiKey" | "baseUrl" | "maxOutputTokens" | "reasoningEffort"
  > & { maxOutputTokens?: number },
) {
  if (!run.escalationCredentialId)
    throw new TemporaryCredentialError("ANALYSIS_CREDENTIAL_MISSING");
  const provider = aiRouteProviderSchema.safeParse(run.escalationProvider);
  if (!provider.success) throw new ReviewRouteError("REVIEW_ROUTE_UNSUPPORTED");
  const route = getAnalysisProviderConfiguration(provider.data);
  return withTemporaryCredential(
    {
      credentialId: run.escalationCredentialId,
      ownerUserId: run.ownerUserId,
      provider: provider.data,
      purpose: "review_escalation",
      bindingId: run.id,
      requiredModelId: request.modelId,
    },
    (apiKey) =>
      requestProviderStructured(provider.data, {
        ...request,
        baseUrl: route.baseUrl,
        maxOutputTokens: request.maxOutputTokens ?? route.maxOutputTokens,
        reasoningEffort: route.reasoningEffort,
        zeroDataRetention: route.zeroDataRetention,
        apiKey,
      }),
  );
}
