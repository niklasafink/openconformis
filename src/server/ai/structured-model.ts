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

export class ModelProviderError extends Error {
  constructor(
    public readonly code:
      | "INVALID_EU_ROUTE"
      | "INVALID_PROVIDER_ROUTE"
      | "PROVIDER_HTTP_ERROR"
      | "PROVIDER_RESPONSE_TOO_LARGE"
      | "PROVIDER_RESPONSE_INVALID"
      | "PROVIDER_OUTPUT_INCOMPLETE"
      | "PROVIDER_REFUSAL"
      | "MODEL_OUTPUT_INVALID",
    public readonly retryable: boolean,
    /**
     * Kurze, gekürzte Begründung des Anbieters. Ohne sie bleibt ein
     * Konfigurationsfehler wie „Regional routing not enabled for this account"
     * als blosses `PROVIDER_HTTP_ERROR` unsichtbar, und der Lauf meldet nur
     * „fehlgeschlagen". Bewusst nur die Meldung des Anbieters, nie Anfrage,
     * Header oder Antwortkörper — dort stünden Policy-Inhalte und Schlüssel.
     */
    public readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ModelProviderError";
  }
}

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
  } catch {
    throw new ModelProviderError("MODEL_OUTPUT_INVALID", false);
  }
}

export function dollarsToMicrounits(cost?: number) {
  return cost === undefined ? undefined : Math.round(cost * 1_000_000);
}
