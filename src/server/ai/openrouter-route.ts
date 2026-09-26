import "server-only";

import { ModelProviderError } from "./structured-model";

export function openRouterBaseUrl() {
  return (
    process.env.OPENROUTER_BASE_URL?.trim() ||
    process.env.OPENROUTER_EU_BASE_URL?.trim() ||
    "https://openrouter.ai/api/v1"
  );
}

export function openRouterZeroDataRetention() {
  return process.env.OPENROUTER_ZDR?.trim().toLowerCase() === "true";
}

const providerSorts = new Set(["latency", "throughput", "price"]);

/**
 * Wie OpenRouter unter den Hosts desselben Modells wählt. Ohne Angabe gewichtet
 * OpenRouter nach Preis; `latency` oder `throughput` bevorzugen schnelle Hosts. Das
 * Modell bleibt dasselbe, nur der ausführende Anbieter wechselt.
 */
export function openRouterProviderSort() {
  const value = process.env.OPENROUTER_PROVIDER_SORT?.trim().toLowerCase();
  return value && providerSorts.has(value) ? value : undefined;
}

export function openRouterModelsUrl(
  input: { baseUrl: string; zeroDataRetention: boolean },
  user = false,
  /** Ein Router wie `typesafe/jev-router` meldet keine Parameter und fiele sonst heraus. */
  structuredOutputs = true,
) {
  const url = openRouterUrl(input.baseUrl, user ? "models/user" : "models");
  if (input.zeroDataRetention) url.searchParams.set("zdr", "true");
  if (url.hostname === "eu.openrouter.ai") url.searchParams.set("region", "eu");
  if (structuredOutputs) url.searchParams.set("supported_parameters", "structured_outputs");
  return url;
}

// Nur die beiden echten OpenRouter-Hosts. Die Liste bleibt geschlossen, damit die
// Basis-URL nicht auf einen beliebigen Host zeigen kann; welcher der beiden
// zulässig ist, entscheidet der Betreiber über die Konfiguration.
const openRouterHosts = new Set(["eu.openrouter.ai", "openrouter.ai"]);

export function openRouterUrl(baseUrl: string, path: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  if (
    url.protocol !== "https:" ||
    !openRouterHosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname.replace(/\/$/u, "") !== "/api/v1"
  ) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  url.pathname = `/api/v1/${path}`;
  url.search = "";
  url.hash = "";
  return url;
}
