import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";

import { requestAnthropicStructured } from "./anthropic";
import { requestGoogleStructured } from "./google";
import { requestOpenAiStructured } from "./openai";
import { requestOpenRouterStructured } from "./openrouter";
import { requestRequestyStructured } from "./requesty";
import type { StructuredModelRequest, StructuredModelResponse } from "./structured-model";

export class ProviderRouteConfigurationError extends Error {
  constructor(public readonly code: "STRICT_PRIVACY_ROUTE_UNAVAILABLE" | "TOKEN_LIMIT_INVALID") {
    super(code);
    this.name = "ProviderRouteConfigurationError";
  }
}

export type AnalysisProviderConfiguration = {
  provider: AiRouteProvider;
  baseUrl: string;
  maxOutputTokens: number;
  privacyProfileId: "eu-zdr-v1";
};

function maxOutputTokens() {
  const value = Number.parseInt(process.env.BYOK_MAX_OUTPUT_TOKENS?.trim() || "4000", 10);
  if (!Number.isInteger(value) || value < 1 || value > 16_000) {
    throw new ProviderRouteConfigurationError("TOKEN_LIMIT_INVALID");
  }
  return value;
}

export function isStrictAnalysisProviderAvailable(provider: AiRouteProvider) {
  switch (provider) {
    case "openrouter":
      return Boolean(process.env.OPENROUTER_EU_BASE_URL?.trim());
    case "requesty":
      return process.env.BYOK_REQUESTY_EU_ZDR_ENABLED === "true";
    case "openai":
      return process.env.BYOK_OPENAI_EU_ZDR_ENABLED === "true";
    case "anthropic":
    case "google":
      return false;
  }
}

export function getStrictAnalysisProviderConfiguration(
  provider: AiRouteProvider,
): AnalysisProviderConfiguration {
  if (!isStrictAnalysisProviderAvailable(provider)) {
    throw new ProviderRouteConfigurationError("STRICT_PRIVACY_ROUTE_UNAVAILABLE");
  }
  const baseUrl =
    provider === "openrouter"
      ? process.env.OPENROUTER_EU_BASE_URL?.trim()
      : provider === "requesty"
        ? "https://router.eu.requesty.ai/v1"
        : provider === "openai"
          ? "https://eu.api.openai.com/v1"
          : undefined;
  if (!baseUrl) throw new ProviderRouteConfigurationError("STRICT_PRIVACY_ROUTE_UNAVAILABLE");
  return { provider, baseUrl, maxOutputTokens: maxOutputTokens(), privacyProfileId: "eu-zdr-v1" };
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
 * Leitet das Datenschutzprofil des gesponserten Laufs aus der tatsächlich
 * konfigurierten Route ab, statt es frei setzen zu lassen.
 *
 * Ein Ergebnis, das mit abgeschaltetem Zero Data Retention oder ausserhalb der
 * EU-Route entstanden ist, darf im Nachweis nicht als `eu-zdr-v1` erscheinen —
 * das wäre eine falsche Zusage in genau dem Dokument, das die Zusage belegen soll.
 */
export function sponsoredPrivacyProfileId(input: {
  baseUrl: string;
  zeroDataRetention: boolean;
}): string {
  let euRoute = false;
  try {
    euRoute = new URL(input.baseUrl).hostname === "eu.openrouter.ai";
  } catch {
    euRoute = false;
  }
  if (euRoute && input.zeroDataRetention) return "eu-zdr-v1";
  return `openrouter-${euRoute ? "eu" : "global"}-${input.zeroDataRetention ? "zdr" : "no-zdr"}-v1`;
}

/** Gesponserte Route: EU-Host und ZDR sind Standard, Abweichung ist ausdrücklich. */
export function sponsoredZeroDataRetention() {
  return process.env.SPONSORED_OPENROUTER_ZDR?.trim().toLowerCase() !== "false";
}
