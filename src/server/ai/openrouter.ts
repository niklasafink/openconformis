import "server-only";

import { z } from "zod";

import {
  assertStructuredRequest,
  dollarsToMicrounits,
  fetchProviderJson,
  ModelProviderError,
  parseStructuredOutput,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from "./structured-model";

export {
  ModelProviderError,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from "./structured-model";

const openRouterResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  provider: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
      prompt_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().optional() })
        .optional(),
      completion_tokens_details: z
        .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
        .optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

// Nur die beiden echten OpenRouter-Hosts. Die Liste bleibt geschlossen, damit die
// Basis-URL nicht auf einen beliebigen Host zeigen kann; welcher der beiden
// zulässig ist, entscheidet der Betreiber über die Konfiguration.
const openRouterHosts = new Set(["eu.openrouter.ai", "openrouter.ai"]);

function chatCompletionsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    !openRouterHosts.has(url.hostname) ||
    url.port ||
    url.pathname.replace(/\/$/u, "") !== "/api/v1"
  ) {
    throw new ModelProviderError("INVALID_EU_ROUTE", false);
  }
  url.pathname = "/api/v1/chat/completions";
  url.search = "";
  url.hash = "";
  return url;
}

export async function requestOpenRouterStructured<T>(
  request: StructuredModelRequest<T>,
  fetchImplementation: typeof fetch = fetch,
): Promise<StructuredModelResponse<T>> {
  const endpoint = chatCompletionsUrl(request.baseUrl);
  assertStructuredRequest(request);
  if (!request.providerOnly?.length) {
    throw new ModelProviderError("INVALID_EU_ROUTE", false);
  }

  const { payload } = await fetchProviderJson(
    endpoint,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
        "http-referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://conformisgrc.com",
        "x-title": "Conformis regulatory gap analysis",
      },
      body: JSON.stringify({
        model: request.modelId,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: 0,
        max_tokens: request.maxOutputTokens,
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
        provider: {
          only: request.providerOnly,
          allow_fallbacks: false,
          // `require_parameters` ist hier bewusst nicht gesetzt: OpenRouter führt
          // für manche Anbieter unvollständige Parameterlisten — für Claude etwa
          // ohne `temperature` —, sodass die Prüfung fälschlich jeden Endpunkt
          // ausschliesst. Die Fähigkeitszusage kommt stattdessen aus `only`, das
          // genau einen geprüften Anbieter festlegt, und die Antwort wird
          // ohnehin strikt gegen das Schema geparst: hält ein Anbieter es nicht
          // ein, scheitert der Lauf sichtbar mit MODEL_OUTPUT_INVALID.
          data_collection: "deny",
          zdr: request.zeroDataRetention ?? true,
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMilliseconds ?? 120_000),
    },
    fetchImplementation,
  );
  let providerResponse: z.infer<typeof openRouterResponseSchema>;
  try {
    providerResponse = openRouterResponseSchema.parse(payload);
  } catch {
    throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);
  }

  const rawOutput = providerResponse.choices[0]?.message.content;
  if (!rawOutput) throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);

  const output = parseStructuredOutput(rawOutput, request.outputSchema);

  return {
    providerRequestId: providerResponse.id,
    requestedModelId: request.modelId,
    resolvedModelId: providerResponse.model,
    resolvedProvider: providerResponse.provider,
    output,
    rawOutput,
    inputTokens: providerResponse.usage?.prompt_tokens,
    cachedInputTokens: providerResponse.usage?.prompt_tokens_details?.cached_tokens,
    outputTokens: providerResponse.usage?.completion_tokens,
    reasoningTokens: providerResponse.usage?.completion_tokens_details?.reasoning_tokens,
    costMicrounits: dollarsToMicrounits(providerResponse.usage?.cost),
  };
}
