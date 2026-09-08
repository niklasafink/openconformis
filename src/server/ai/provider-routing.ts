import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";

import { openRouterBaseUrl, openRouterZeroDataRetention } from "./openrouter-route";
export { openRouterZeroDataRetention } from "./openrouter-route";

import { requestAnthropicStructured } from "./anthropic";
import { requestGoogleStructured } from "./google";
import { requestOpenAiStructured } from "./openai";
import { requestOpenRouterStructured } from "./openrouter";
import { requestRequestyStructured } from "./requesty";
import type { StructuredModelRequest, StructuredModelResponse } from "./structured-model";

export class ProviderRouteConfigurationError extends Error {
  constructor(public readonly code: "ANALYSIS_ROUTE_UNAVAILABLE" | "TOKEN_LIMIT_INVALID") {
    super(code);
    this.name = "ProviderRouteConfigurationError";
  }
}

export type AnalysisProviderConfiguration = {
  provider: AiRouteProvider;
  baseUrl: string;
  maxOutputTokens: number;
  zeroDataRetention: boolean;
  /** Beschreibt die tatsächlich verwendete Route, statt eine Zusage zu behaupten. */
  privacyProfileId: string;
};

function maxOutputTokens() {
  const value = Number.parseInt(process.env.BYOK_MAX_OUTPUT_TOKENS?.trim() || "4000", 10);
  if (!Number.isInteger(value) || value < 1 || value > 16_000) {
    throw new ProviderRouteConfigurationError("TOKEN_LIMIT_INVALID");
  }
  return value;
}

/** Basis-URL der Analyse-Route je Anbieter. */
function analysisBaseUrl(provider: AiRouteProvider) {
  switch (provider) {
    case "openrouter":
      return openRouterBaseUrl();
    case "requesty":
      return "https://router.requesty.ai/v1";
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
    case "google":
      return undefined;
  }
}

export function isAnalysisProviderAvailable(provider: AiRouteProvider) {
  return Boolean(analysisBaseUrl(provider));
}

export function getAnalysisProviderConfiguration(
  provider: AiRouteProvider,
): AnalysisProviderConfiguration {
  const baseUrl = analysisBaseUrl(provider);
  if (!baseUrl) throw new ProviderRouteConfigurationError("ANALYSIS_ROUTE_UNAVAILABLE");
  const zeroDataRetention = provider === "openrouter" && openRouterZeroDataRetention();
  return {
    provider,
    baseUrl,
    maxOutputTokens: maxOutputTokens(),
    zeroDataRetention,
    privacyProfileId: analysisRouteProfileId({ provider, baseUrl, zeroDataRetention }),
  };
}

export function requestProviderStructured<T>(
  provider: AiRouteProvider,
  request: StructuredModelRequest<T>,
  fetchImplementation: typeof fetch = fetch,
): Promise<StructuredModelResponse<T>> {
  switch (provider) {
    case "openrouter":
      return requestOpenRouterStructured(request, fetchImplementation);
    case "requesty":
      return requestRequestyStructured(request, fetchImplementation);
    case "anthropic":
      return requestAnthropicStructured(request, fetchImplementation);
    case "google":
      return requestGoogleStructured(request, fetchImplementation);
    case "openai":
      return requestOpenAiStructured(request, fetchImplementation);
  }
}

/**
 * Leitet das Datenschutzprofil einer Analyse-Route aus der tatsächlich
 * konfigurierten Route ab, statt es frei setzen zu lassen.
 *
 * Ein Ergebnis, das mit abgeschaltetem Zero Data Retention entstanden ist, darf
 * im Nachweis nicht als `zdr` erscheinen — das wäre eine falsche Zusage in genau
 * dem Dokument, das die Zusage belegen soll.
 */
export function analysisRouteProfileId(input: {
  provider: AiRouteProvider;
  baseUrl: string;
  zeroDataRetention: boolean;
}): string {
  let host = "unknown";
  try {
    host = new URL(input.baseUrl).hostname;
  } catch {
    host = "unknown";
  }
  return `${input.provider}-${host}-${input.zeroDataRetention ? "zdr" : "no-zdr"}-v1`;
}
