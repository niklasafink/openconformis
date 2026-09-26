import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";
import { hedgedRequest } from "./hedged-request";
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

/**
 * Nach wie vielen Sekunden ein zweiter, identischer Aufruf startet. Gemessen (2026-09-26):
 * alle Aufrufe über 20 s rechneten tatsächlich — 2.000 bis 3.700 Tokens, längster 42 s —,
 * ein Zweitaufruf wäre genauso lang und doppelt bezahlt. Nur ein hängender Anbieter
 * (83 s für eine sonst 5-s-Bewertung) profitiert. 60 s fängt ihn ab, ohne je einen
 * rechnenden Aufruf zu verdoppeln. `0` schaltet ab.
 */
function hedgeAfterMilliseconds() {
  const seconds = Number.parseInt(process.env.ANALYSIS_HEDGE_AFTER_SECONDS?.trim() || "60", 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds * 1_000 : 0;
}

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
      hedgedRequest(
        (signal) =>
          requestProviderStructured(analysis.routeProvider, {
            ...request,
            baseUrl: provider.baseUrl,
            maxOutputTokens: request.maxOutputTokens ?? provider.maxOutputTokens,
            reasoningEffort: provider.reasoningEffort,
            zeroDataRetention: provider.zeroDataRetention,
            apiKey,
            signal,
          }),
        hedgeAfterMilliseconds(),
      ),
  );
}
