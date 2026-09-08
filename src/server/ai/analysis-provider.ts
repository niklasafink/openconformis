import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";
import { getAnalysisProviderConfiguration, requestProviderStructured } from "./provider-routing";
import { TemporaryCredentialError, withTemporaryCredential } from "./temporary-credential-service";
import type { StructuredModelRequest } from "./structured-model";

type AnalysisCredentialBinding = {
  aiCredentialId: string | null;
  ownerUserId: string;
  routeProvider: AiRouteProvider;
  sourceDraftId: string;
};

export async function requestStructuredForAnalysis<T>(
  analysis: AnalysisCredentialBinding,
  request: Omit<StructuredModelRequest<T>, "apiKey" | "baseUrl" | "maxOutputTokens">,
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
      requiredModelId: request.modelId,
    },
    (apiKey) =>
      requestProviderStructured(analysis.routeProvider, {
        ...request,
        baseUrl: provider.baseUrl,
        maxOutputTokens: provider.maxOutputTokens,
        zeroDataRetention: provider.zeroDataRetention,
        apiKey,
      }),
  );
}
