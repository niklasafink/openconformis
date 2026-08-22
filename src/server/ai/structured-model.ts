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
  ) {
    super(code);
    this.name = "ModelProviderError";
  }
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
    throw new ModelProviderError("PROVIDER_HTTP_ERROR", retryableProviderStatus(response.status));
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
