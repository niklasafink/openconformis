import "server-only";

import { z } from "zod";

export type StructuredModelRequest<T> = {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  outputSchema: z.ZodType<T>;
  providerOnly?: string[];
  /**
   * Verlangt vom Anbieter Zero Data Retention. Standard ist an — abschalten ist
   * eine bewusste Entscheidung des Betreibers und schlägt sich im Datenschutz-
   * profil des Laufs nieder, damit ein Ergebnis nie strenger aussieht als es war.
   */
  zeroDataRetention?: boolean;
  maxOutputTokens: number;
  timeoutMilliseconds?: number;
};

export type StructuredModelResponse<T> = {
  providerRequestId: string;
  requestedModelId: string;
  resolvedModelId: string;
  resolvedProvider?: string;
  output: T;
  rawOutput: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  costMicrounits?: number;
};

export type ModelProviderErrorCode =
  | "INVALID_EU_ROUTE"
  | "INVALID_PROVIDER_ROUTE"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_OUTPUT_INCOMPLETE"
  | "PROVIDER_REFUSAL"
  | "MODEL_OUTPUT_INVALID";

export class ModelProviderError extends Error {
  constructor(
    public readonly code: ModelProviderErrorCode,
    public readonly retryable: boolean,
    /**
     * Kurze, gekürzte Begründung des Anbieters. Ohne sie bleibt ein
     * Konfigurationsfehler wie „Regional routing not enabled for this account"
     * als blosses `PROVIDER_HTTP_ERROR` unsichtbar, und der Lauf meldet nur
     * „fehlgeschlagen". Bewusst nur die Meldung des Anbieters, nie Anfrage,
     * Header oder Antwortkörper — dort stünden Policy-Inhalte und Schlüssel.
     */
    detail?: string,
  ) {
    super(detail ?? defaultProviderDetail[code]);
    this.name = "ModelProviderError";
    this.detail = detail ?? defaultProviderDetail[code];
  }

  /** Immer gesetzt: entweder die Meldung des Anbieters oder die Erklärung zum Code. */
  public readonly detail: string;
}

/**
 * Jeder Providerfehler muss sich selbst erklären. Ohne diese Texte erschien etwa
 * eine unzulässige Basis-URL im Ergebnis nur als „ANALYSIS_RETRIES_EXHAUSTED" —
 * ein Code, der weder die Ursache nennt noch sagt, wo sie zu beheben ist.
 */
const defaultProviderDetail: Record<ModelProviderErrorCode, string> = {
  INVALID_EU_ROUTE:
    "Die konfigurierte Basis-URL ist keine zugelassene EU-Route. Für OpenRouter ist ausschließlich https://eu.openrouter.ai/api/v1 erlaubt.",
  INVALID_PROVIDER_ROUTE:
    "Die Providerkonfiguration ist unvollständig — API-Schlüssel oder Token-Obergrenze fehlen oder sind ungültig.",
  PROVIDER_HTTP_ERROR: "Der Modellanbieter war nicht erreichbar.",
  PROVIDER_RESPONSE_TOO_LARGE: "Die Antwort des Modellanbieters war zu groß.",
  PROVIDER_RESPONSE_INVALID: "Die Antwort des Modellanbieters war nicht auswertbar.",
  PROVIDER_OUTPUT_INCOMPLETE:
    "Das Modell hat die Antwort abgeschnitten. Die Token-Obergrenze ist zu niedrig.",
  PROVIDER_REFUSAL: "Das Modell hat die Bearbeitung abgelehnt.",
  MODEL_OUTPUT_INVALID:
    "Das Modell hat kein gültiges Ergebnis nach dem vereinbarten Schema geliefert.",
};

const maximumProviderDetailLength = 200;

/** Zieht die Fehlermeldung aus den bei allen Anbietern üblichen Formen. */
export function readProviderErrorDetail(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload.slice(0, maximumProviderDetailLength);
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  const candidate =
    (typeof error === "object" &&
    error &&
    typeof (error as Record<string, unknown>).message === "string"
      ? ((error as Record<string, unknown>).message as string)
      : undefined) ??
    (typeof error === "string" ? error : undefined) ??
    (typeof record.message === "string" ? record.message : undefined);
  return candidate?.trim().slice(0, maximumProviderDetailLength) || undefined;
}

export function assertStructuredRequest(request: { apiKey: string; maxOutputTokens: number }) {
  if (!request.apiKey.trim()) throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
}

export function retryableProviderStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function readProviderJson(response: Response) {
  if (!response.ok) {
    // Den Fehlerkörper noch lesen, bevor geworfen wird: er trägt die einzige
    // Auskunft darüber, warum der Anbieter abgelehnt hat.
    let detail: string | undefined;
    try {
      detail = readProviderErrorDetail(JSON.parse((await response.text()).slice(0, 4_000)));
    } catch {
      detail = undefined;
    }
    throw new ModelProviderError(
      "PROVIDER_HTTP_ERROR",
      retryableProviderStatus(response.status),
      detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > 2_000_000) {
    throw new ModelProviderError("PROVIDER_RESPONSE_TOO_LARGE", false);
  }
  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw new ModelProviderError("PROVIDER_HTTP_ERROR", true);
  }
  if (responseText.length > 2_000_000) {
    throw new ModelProviderError("PROVIDER_RESPONSE_TOO_LARGE", false);
  }
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);
  }
}

export async function fetchProviderJson(
  url: URL,
  init: RequestInit,
  fetchImplementation: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetchImplementation(url, init);
  } catch {
    throw new ModelProviderError("PROVIDER_HTTP_ERROR", true);
  }
  return { response, payload: await readProviderJson(response) };
}

export function parseStructuredOutput<T>(rawOutput: string, outputSchema: z.ZodType<T>): T {
  try {
    return outputSchema.parse(JSON.parse(rawOutput));
  } catch (error) {
    // Die verletzten Regeln benennen, statt sie zu verwerfen: der zweite Versuch
    // bekam bisher nur „schema validation failed" und scheiterte deshalb
    // zuverlässig ein zweites Mal an derselben Stelle. Die Meldungen stammen aus
    // dem eigenen Schema und enthalten keine Policy-Inhalte.
    throw new ModelProviderError("MODEL_OUTPUT_INVALID", false, describeSchemaIssues(error));
  }
}

function describeSchemaIssues(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .slice(0, 6);
  return issues.length ? issues.join("; ").slice(0, 400) : undefined;
}

export function dollarsToMicrounits(cost?: number) {
  return cost === undefined ? undefined : Math.round(cost * 1_000_000);
}
