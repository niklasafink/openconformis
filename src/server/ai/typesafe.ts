import "server-only";

import {
  systemOneModelId,
  systemOneRequestSchema,
  systemOneResponseSchema,
  type SystemOneQuestion,
  type SystemOneResponseBody,
} from "@/domain/ai/system-one";

import {
  describeSchemaIssues,
  invalidProviderResponse,
  ModelProviderError,
  readProviderErrorDetail,
} from "./structured-model";

/**
 * Adapter für TypeSafe System One („Jev"). Bewusst **nicht** über
 * `requestProviderStructured`: dessen Vertrag ist ein Textmodell mit JSON-Schema.
 * Jev ist ein Entscheidungsdienst, der nie Text zurückgibt, und braucht deshalb
 * einen eigenen, schmalen Weg — genau wie `anthropic.ts` einen eigenen hat.
 */

export { systemOneModelId };

/** Die einzige erlaubte Route. Ein anderer Host ist ein Konfigurationsfehler, kein Ausfall. */
export const systemOneBaseUrl = "https://api.typesafe.ai/v1";

export const systemOneRequestTimeoutMilliseconds = 60_000;

export type SystemOneRequest = {
  apiKey: string;
  /** Standardmäßig `systemOneBaseUrl`; abweichende Hosts werden abgewiesen. */
  baseUrl?: string;
  modelId?: string;
  /** Der zu beurteilende Text. Bleibt im Original, also deutsch. */
  state: string;
  /** Fragen teilen sich den Zustand; jede zusätzliche Frage kostet fast nichts. */
  questions: Record<string, SystemOneQuestion>;
  timeoutMilliseconds?: number;
};

export type SystemOneResult = {
  requestedModelId: string;
  resolvedModelId: string;
  answers: SystemOneResponseBody["answers"];
  inputTokens?: number;
  outputTokens?: number;
  latencyMilliseconds: number;
};

/**
 * Host-Allowlist analog `anthropic.ts`. Sie verhindert, dass eine falsch gesetzte
 * Umgebungsvariable den Schlüssel des Nutzers an einen fremden Host schickt.
 */
function systemOneUrl(baseUrl: string) {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.typesafe.ai" ||
    url.port ||
    (url.pathname.replace(/\/$/u, "") !== "/v1" && url.pathname !== "")
  ) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  url.pathname = "/v1/systemone";
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * `Retry-After` in Sekunden. Der Anbieter sendet entweder eine Sekundenzahl oder ein
 * HTTP-Datum. Ohne den Wert würde die Drosselung raten und entweder zu früh wieder
 * anklopfen oder unnötig lange warten.
 */
function retryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 300);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(Math.ceil((date - Date.now()) / 1000), 0), 300);
}

function mapStatus(status: number, detail: string | undefined, headers: Headers): never {
  if (status === 401 || status === 403) {
    throw new ModelProviderError("PROVIDER_CREDENTIAL_INVALID", false, detail);
  }
  if (status === 400 || status === 404 || status === 422) {
    throw new ModelProviderError("PROVIDER_REQUEST_INVALID", false, detail);
  }
  if (status === 429) {
    throw new ModelProviderError(
      "PROVIDER_RATE_LIMITED",
      true,
      detail,
      retryAfterSeconds(headers) ?? 1,
    );
  }
  if (status === 408 || status === 529 || status >= 500) {
    throw new ModelProviderError("PROVIDER_UNAVAILABLE", true, detail);
  }
  throw new ModelProviderError(
    "PROVIDER_HTTP_ERROR",
    false,
    detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`,
  );
}

/**
 * Stellt eine getypte Frage an Jev.
 *
 * Die Zeitgrenze wird zusätzlich über einen eigenen Timer erzwungen, weil
 * `AbortSignal.timeout` einen stehengebliebenen Lesevorgang nicht zuverlässig
 * abbricht — dieselbe Erfahrung wie in `fetchProviderJson`.
 */
export async function requestSystemOne(
  request: SystemOneRequest,
  fetchImplementation: typeof fetch = fetch,
): Promise<SystemOneResult> {
  if (!request.apiKey.trim()) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  const modelId = request.modelId ?? systemOneModelId;
  const url = systemOneUrl(request.baseUrl ?? systemOneBaseUrl);
  const body = systemOneRequestSchema.safeParse({
    model: modelId,
    state: request.state,
    questions: request.questions,
  });
  if (!body.success) {
    throw new ModelProviderError(
      "PROVIDER_REQUEST_INVALID",
      false,
      describeSchemaIssues(body.error),
    );
  }

  const timeoutMilliseconds = request.timeoutMilliseconds ?? systemOneRequestTimeoutMilliseconds;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ModelProviderError(
            "PROVIDER_UNAVAILABLE",
            true,
            `TypeSafe hat nach ${Math.round(timeoutMilliseconds / 1000)} Sekunden nicht geantwortet.`,
          ),
        ),
      timeoutMilliseconds,
    );
  });

  let response: Response;
  try {
    response = await Promise.race([
      fetchImplementation(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${request.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body.data),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMilliseconds),
      }),
      deadline,
    ]);
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    throw new ModelProviderError("PROVIDER_UNAVAILABLE", true, "TypeSafe war nicht erreichbar.");
  } finally {
    if (timer) clearTimeout(timer);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ModelProviderError(
      "PROVIDER_UNAVAILABLE",
      true,
      "Die Verbindung zu TypeSafe brach beim Lesen der Antwort ab.",
    );
  }
  if (text.length > 2_000_000) {
    throw new ModelProviderError("PROVIDER_RESPONSE_TOO_LARGE", false);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    // Nur die Meldung des Anbieters, nie Anfrage oder Körper: dort stünde der
    // Vertragstext und im Kopf der Schlüssel.
    mapStatus(response.status, readProviderErrorDetail(payload), response.headers);
  }

  const parsed = systemOneResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidProviderResponse(`unerwartetes Format (${describeSchemaIssues(parsed.error)})`);
  }

  const missing = Object.keys(body.data.questions).filter(
    (key) => !Object.hasOwn(parsed.data.answers, key),
  );
  if (missing.length > 0) {
    // Eine fehlende Antwort darf nicht als „keine Aussage" durchgehen: die Zelle
    // bekäme sonst still ein Ergebnis, das niemand beantwortet hat.
    throw invalidProviderResponse(`Antwort fehlt für ${missing.slice(0, 5).join(", ")}`);
  }

  return {
    requestedModelId: modelId,
    resolvedModelId: parsed.data.model,
    answers: parsed.data.answers,
    inputTokens: parsed.data.usage?.input_tokens ?? undefined,
    outputTokens: parsed.data.usage?.output_tokens ?? undefined,
    latencyMilliseconds: Date.now() - startedAt,
  };
}
