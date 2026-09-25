import "server-only";

import type { AiRouteProvider } from "@/domain/ai/provider";
import { configuredSet } from "@/server/environment";

import { openRouterBaseUrl, openRouterZeroDataRetention } from "./openrouter-route";
export { openRouterZeroDataRetention } from "./openrouter-route";

import { requestAnthropicStructured } from "./anthropic";
import { requestGoogleStructured } from "./google";
import { requestOpenAiStructured } from "./openai";
import { requestOpenRouterStructured } from "./openrouter";
import { requestRequestyStructured } from "./requesty";
import {
  ModelProviderError,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from "./structured-model";

export class ProviderRouteConfigurationError extends Error {
  constructor(
    public readonly code:
      "ANALYSIS_ROUTE_UNAVAILABLE" | "TOKEN_LIMIT_INVALID" | "REASONING_EFFORT_INVALID",
  ) {
    super(code);
    this.name = "ProviderRouteConfigurationError";
  }
}

export type AnalysisProviderConfiguration = {
  provider: AiRouteProvider;
  baseUrl: string;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  zeroDataRetention: boolean;
  /** Beschreibt die tatsächlich verwendete Route, statt eine Zusage zu behaupten. */
  privacyProfileId: string;
};

export const maximumOutputTokens = 32_000;

/**
 * Denk-Tokens zählen zum Ausgabelimit. Claude Sonnet 5 denkt ohne Vorgabe mit und
 * verbrauchte in der Verifikation bis zu 3.000 Tokens, bevor das JSON begann —
 * bei 4.000 wurde die Antwort abgeschnitten.
 */
function maxOutputTokens() {
  const value = Number.parseInt(process.env.BYOK_MAX_OUTPUT_TOKENS?.trim() || "8000", 10);
  if (!Number.isInteger(value) || value < 1 || value > maximumOutputTokens) {
    throw new ProviderRouteConfigurationError("TOKEN_LIMIT_INVALID");
  }
  return value;
}

const reasoningEfforts = ["none", "minimal", "low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];

/**
 * Wie lange ein Denkmodell vor der Antwort überlegen darf. Die Dauer eines Aufrufs
 * hängt fast nur an den erzeugten Tokens; Belege und Schema werden danach ohnehin
 * deterministisch geprüft. Deshalb standardmässig knapp.
 */
function reasoningEffort(): ReasoningEffort {
  const value = process.env.BYOK_REASONING_EFFORT?.trim().toLowerCase() || "low";
  if (!(reasoningEfforts as readonly string[]).includes(value)) {
    throw new ProviderRouteConfigurationError("REASONING_EFFORT_INVALID");
  }
  return value as ReasoningEffort;
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
    // TypeSafe ist ein Entscheidungsdienst, kein Bewertungsmodell: Jev gibt nie
    // Text zurück. Ohne Basis-URL liefert `isAnalysisProviderAvailable` weiterhin
    // `false`, und Jev taucht nie im Modellwähler für Analyse oder Chat auf.
    case "typesafe":
      return undefined;
  }
}

/**
 * Freigegebene BYOK-Anbieter. Ohne gesetzte Liste bleibt OpenRouter erlaubt,
 * die Route aller Modelle der Auswahl — eine leere oder beim Speichern
 * verlorene Variable sperrte sonst jede Schlüsseleingabe.
 */
export function allowedByokProviders(): ReadonlySet<string> {
  const configured = configuredSet("BYOK_PROVIDER_ALLOWLIST");
  return configured.size > 0 ? configured : new Set(["openrouter"]);
}

/**
 * Das Modell der Verifikation. Über OpenRouter prüft Claude Sonnet 5 jede
 * ausgelöste Bewertung, gleich welches Modell bewertet hat: Im Vergleich mit einer
 * Referenz von Claude Fable fand ein zweites Modell einer anderen Familie mehr
 * übersehene Lücken als ein Modell, das sich selbst prüft. Bei direkten
 * Anbietern gilt der Schlüssel nur für dessen eigene Modelle; dort prüft weiter
 * das gewählte Modell.
 */
export const openRouterVerifierModelId = "anthropic/claude-sonnet-5";

export function analysisVerifierModelId(provider: AiRouteProvider, providerModelId: string) {
  return provider === "openrouter" ? openRouterVerifierModelId : providerModelId;
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
    reasoningEffort: reasoningEffort(),
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
    // Erreichbar nur über eine falsch gesetzte Route: Jev beantwortet getypte
    // Fragen über `requestSystemOne` und kann kein JSON-Schema bedienen.
    case "typesafe":
      throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
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
