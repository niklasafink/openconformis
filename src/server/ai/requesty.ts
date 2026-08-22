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

const responseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["completed", "failed", "in_progress", "incomplete"]),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            refusal: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      input_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().optional() })
        .optional(),
      output_tokens_details: z
        .object({ reasoning_tokens: z.number().int().nonnegative().optional() })
        .optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

function responsesUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "router.eu.requesty.ai" ||
    url.port ||
    url.pathname.replace(/\/$/u, "") !== "/v1"
  ) {
    throw new ModelProviderError("INVALID_EU_ROUTE", false);
  }
  url.pathname = "/v1/responses";
  url.search = "";
  url.hash = "";
  return url;
}

export async function requestRequestyStructured<T>(
  request: StructuredModelRequest<T>,
  fetchImplementation: typeof fetch = fetch,
): Promise<StructuredModelResponse<T>> {
  assertStructuredRequest(request);
  const { payload } = await fetchProviderJson(
    responsesUrl(request.baseUrl),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.modelId,
        instructions: request.system,
        input: request.user,
        max_output_tokens: request.maxOutputTokens,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMilliseconds ?? 120_000),
    },
    fetchImplementation,
  );
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);
  if (parsed.data.status !== "completed") {
    throw new ModelProviderError("PROVIDER_OUTPUT_INCOMPLETE", parsed.data.status !== "failed");
  }
  const blocks = parsed.data.output.flatMap((item) => item.content ?? []);
  if (blocks.some((block) => block.type === "refusal" || block.refusal)) {
    throw new ModelProviderError("PROVIDER_REFUSAL", false);
  }
  const rawOutput = blocks
    .filter((block) => block.type === "output_text" && block.text)
    .map((block) => block.text)
    .join("");
  if (!rawOutput) throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);

  return {
    providerRequestId: parsed.data.id,
    requestedModelId: request.modelId,
    resolvedModelId: parsed.data.model,
    resolvedProvider: "requesty",
    output: parseStructuredOutput(rawOutput, request.outputSchema),
    rawOutput,
    inputTokens: parsed.data.usage?.input_tokens,
    cachedInputTokens: parsed.data.usage?.input_tokens_details?.cached_tokens,
    outputTokens: parsed.data.usage?.output_tokens,
    reasoningTokens: parsed.data.usage?.output_tokens_details?.reasoning_tokens,
    costMicrounits: dollarsToMicrounits(parsed.data.usage?.cost),
  };
}
