import "server-only";

import { ModelProviderError } from "./structured-model";

export function openRouterBaseUrl() {
  return process.env.OPENROUTER_BASE_URL?.trim() || process.env.OPENROUTER_EU_BASE_URL?.trim();
}

export function openRouterZeroDataRetention() {
  return process.env.OPENROUTER_ZDR?.trim().toLowerCase() !== "false";
}

export function openRouterModelsUrl(
  input: { baseUrl: string; zeroDataRetention: boolean },
  user = false,
) {
  const url = openRouterUrl(input.baseUrl, user ? "models/user" : "models");
  if (input.zeroDataRetention) url.searchParams.set("zdr", "true");
  if (url.hostname === "eu.openrouter.ai") url.searchParams.set("region", "eu");
  url.searchParams.set("supported_parameters", "structured_outputs");
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
    throw new ModelProviderError("INVALID_EU_ROUTE", false);
  }
  if (
    url.protocol !== "https:" ||
    !openRouterHosts.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname.replace(/\/$/u, "") !== "/api/v1"
  ) {
    throw new ModelProviderError("INVALID_EU_ROUTE", false);
  }
  url.pathname = `/api/v1/${path}`;
  url.search = "";
  url.hash = "";
  return url;
}
