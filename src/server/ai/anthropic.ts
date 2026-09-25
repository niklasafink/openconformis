import "server-only";

import { z } from "zod";

import {
  assertStructuredRequest,
  describeSchemaIssues,
  fetchProviderJson,
  invalidProviderResponse,
  ModelProviderError,
  parseStructuredOutput,
  withBilledUsage,
  type ProviderUsage,
  throwIfProviderErrorPayload,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from "./structured-model";

const responseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  stop_reason: z.string().nullable(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative(),
    output_tokens_details: z
      .object({ thinking_tokens: z.number().int().nonnegative().optional() })
      .nullable()
      .optional(),
  }),
});

function messagesUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.anthropic.com" ||
    url.port ||
    (url.pathname.replace(/\/$/u, "") !== "/v1" && url.pathname !== "")
  ) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  url.pathname = "/v1/messages";
  url.search = "";
  url.hash = "";
  return url;
}

export async function requestAnthropicStructured<T>(
  request: StructuredModelRequest<T>,
  fetchImplementation: typeof fetch = fetch,
): Promise<StructuredModelResponse<T>> {
  assertStructuredRequest(request);
  const { payload } = await fetchProviderJson(
    messagesUrl(request.baseUrl),
    {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": request.apiKey,
      },
      body: JSON.stringify({
        model: request.modelId,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        max_tokens: request.maxOutputTokens,
        temperature: 0,
        output_config: {
          format: {
            type: "json_schema",
            schema: request.jsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMilliseconds ?? 120_000),
    },
    fetchImplementation,
  );
  throwIfProviderErrorPayload(payload);
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidProviderResponse(`unerwartetes Format (${describeSchemaIssues(parsed.error)})`);
  }
  const usage: ProviderUsage = {
    providerRequestId: parsed.data.id,
    inputTokens: parsed.data.usage.input_tokens ?? undefined,
    cachedInputTokens: parsed.data.usage.cache_read_input_tokens ?? undefined,
    outputTokens: parsed.data.usage.output_tokens,
    reasoningTokens: parsed.data.usage.output_tokens_details?.thinking_tokens,
  };
  return withBilledUsage(usage, () => {
    if (parsed.data.stop_reason === "refusal") {
      throw new ModelProviderError("PROVIDER_REFUSAL", false);
    }
    if (parsed.data.stop_reason === "max_tokens") {
      throw new ModelProviderError("PROVIDER_OUTPUT_INCOMPLETE", false);
    }
    const rawOutput = parsed.data.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("");
    if (!rawOutput) {
      throw invalidProviderResponse(
        `leere Antwort (stop_reason: ${parsed.data.stop_reason ?? "keiner"}, Anfrage ${parsed.data.id})`,
      );
    }

    return {
      ...usage,
      requestedModelId: request.modelId,
      resolvedModelId: parsed.data.model,
      resolvedProvider: "anthropic",
      output: parseStructuredOutput(rawOutput, request.outputSchema),
      rawOutput,
    };
  });
}
