import "server-only";

import { z } from "zod";
import { openRouterUrl } from "./openrouter-route";

import {
  assertStructuredRequest,
  describeSchemaIssues,
  dollarsToMicrounits,
  fetchProviderJson,
  invalidProviderResponse,
  ModelProviderError,
  parseStructuredOutput,
  providerRequestTimeoutMilliseconds,
  readProviderErrorDetail,
  throwIfProviderErrorPayload,
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
        // Bei einem Abbruch sendet OpenRouter `content: null` und den Grund in `error`.
        message: z.object({
          content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
        native_finish_reason: z.string().nullable().optional(),
        error: z.unknown().optional(),
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

export async function requestOpenRouterStructured<T>(
  request: StructuredModelRequest<T>,
  fetchImplementation: typeof fetch = fetch,
): Promise<StructuredModelResponse<T>> {
  const endpoint = openRouterUrl(request.baseUrl, "chat/completions");
  assertStructuredRequest(request);
  // Eine Anbieterfestlegung ist optional. Sie war zuvor Pflicht, was BYOK über
  // OpenRouter unmöglich machte: die Datenbank verlangt dort eine leere Liste
  // (analyses_provider_route_check), der Adapter verlangte eine gefüllte.

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
          // Nur senden, was der Betreiber tatsächlich verlangt. Ein leeres
          // Feld wäre für OpenRouter eine Einschränkung auf nichts.
          ...(request.providerOnly?.length ? { only: request.providerOnly } : {}),
          allow_fallbacks: !request.providerOnly?.length,
          // `require_parameters` ist hier bewusst nicht gesetzt: OpenRouter führt
          // für manche Anbieter unvollständige Parameterlisten — für Claude etwa
          // ohne `temperature` —, sodass die Prüfung fälschlich jeden Endpunkt
          // ausschliesst. Die Fähigkeitszusage kommt stattdessen aus `only`, das
          // genau einen geprüften Anbieter festlegt, und die Antwort wird
          // ohnehin strikt gegen das Schema geparst: hält ein Anbieter es nicht
          // ein, scheitert der Lauf sichtbar mit MODEL_OUTPUT_INVALID.
          // Datenschutzauflagen sind Entscheidungen des Betreibers, keine
          // Konstanten. Werden sie nicht verlangt, dürfen sie die Routenwahl
          // auch nicht einschränken.
          ...(request.zeroDataRetention ? { data_collection: "deny", zdr: true } : {}),
        },
      }),
      signal: AbortSignal.timeout(
        request.timeoutMilliseconds ?? providerRequestTimeoutMilliseconds,
      ),
    },
    fetchImplementation,
    request.timeoutMilliseconds ?? providerRequestTimeoutMilliseconds,
  );
  throwIfProviderErrorPayload(payload);
  const parsed = openRouterResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidProviderResponse(`unerwartetes Format (${describeSchemaIssues(parsed.error)})`);
  }
  const providerResponse = parsed.data;
  const choice = providerResponse.choices[0];
  const requestLabel = `Anfrage ${providerResponse.id}`;
  const finishReason = choice?.finish_reason ?? choice?.native_finish_reason;

  // Bricht der vorgelagerte Anbieter während der Generierung ab, steht der Grund
  // an der Auswahl, und `content` ist leer. Ein zweiter Versuch gelingt meist.
  if (choice?.error || finishReason === "error") {
    const message = readProviderErrorDetail({ error: choice?.error });
    throw new ModelProviderError(
      "PROVIDER_HTTP_ERROR",
      true,
      `Abbruch während der Generierung durch ${providerResponse.provider ?? "den Anbieter"}${
        message ? `: ${message}` : ""
      } (${requestLabel})`,
    );
  }

  // Eine abgeschnittene Antwort ist kein Schemafehler, sondern ein zu niedriges
  // Ausgabelimit. Ohne diese Unterscheidung meldete der Lauf „kein gültiges
  // Ergebnis nach dem vereinbarten Schema" und schickte den Betreiber damit auf
  // die falsche Spur — der Anthropic-Adapter prüft das seit jeher.
  if (finishReason === "length" || finishReason === "max_tokens") {
    throw new ModelProviderError(
      "PROVIDER_OUTPUT_INCOMPLETE",
      false,
      `Das Modell hat die Antwort nach ${request.maxOutputTokens} Tokens abgeschnitten. Erhöhen Sie das Ausgabelimit.`,
    );
  }

  const rawOutput = choice?.message.content;
  if (!rawOutput) {
    throw invalidProviderResponse(
      `leere Antwort (finish_reason: ${finishReason ?? "keiner"}, ${
        providerResponse.provider ?? "Anbieter unbekannt"
      }, ${requestLabel})`,
    );
  }

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
