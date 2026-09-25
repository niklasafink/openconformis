import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";
import { getAnalysisProviderConfiguration, requestProviderStructured } from "./provider-routing";
import { TemporaryCredentialError, withTemporaryCredential } from "./temporary-credential-service";
import type { StructuredModelRequest } from "./structured-model";

type AnalysisCredentialBinding = {
  aiCredentialId: string | null;
  ownerUserId: string;
  /** Das gewählte Modell, für das der Schlüssel beim Verbinden geprüft wurde. */
  providerModelId: string;
  routeProvider: AiRouteProvider;
  sourceDraftId: string;
};

export async function requestStructuredForAnalysis<T>(
  analysis: AnalysisCredentialBinding,
  request: Omit<
    StructuredModelRequest<T>,
    "apiKey" | "baseUrl" | "maxOutputTokens" | "reasoningEffort"
  > & {
    /** Nur für einen Wiederholungsversuch nach abgeschnittener Antwort. */
    maxOutputTokens?: number;
  },
) {
  if (!analysis.aiCredentialId) throw new TemporaryCredentialError("ANALYSIS_CREDENTIAL_MISSING");
  const provider = getAnalysisProviderConfiguration(analysis.routeProvider);
  return withTemporaryCredential(
    {
      credentialId: analysis.aiCredentialId,
      ownerUserId: analysis.ownerUserId,
      provider: analysis.routeProvider,
      purpose: "analysis",
      bindingId: analysis.sourceDraftId,
      // Der Schlüssel ist an das gewählte Modell gebunden. Die Verifikation ruft
      // über ihn ein festes zweites Modell auf, das beim Verbinden mitgeprüft
      // wurde (`analysisVerifierModelId`).
      requiredModelId: analysis.providerModelId,
    },
    (apiKey) =>
      requestProviderStructured(analysis.routeProvider, {
        ...request,
        baseUrl: provider.baseUrl,
        maxOutputTokens: request.maxOutputTokens ?? provider.maxOutputTokens,
        reasoningEffort: provider.reasoningEffort,
        zeroDataRetention: provider.zeroDataRetention,
        apiKey,
      }),
  );
}
