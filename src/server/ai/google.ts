import "server-only";

import { z } from "zod";

import {
  assertStructuredRequest,
  fetchProviderJson,
  ModelProviderError,
  parseStructuredOutput,
  type StructuredModelRequest,
  type StructuredModelResponse,
} from "./structured-model";

const responseSchema = z.object({
  responseId: z.string().min(1).optional(),
  modelVersion: z.string().min(1).optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z.object({
          parts: z.array(z.object({ text: z.string().optional() })),
        }),
      }),
    )
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().optional(),
      cachedContentTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
      thoughtsTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

function generateContentUrl(baseUrl: string, modelId: string) {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "generativelanguage.googleapis.com" ||
    url.port ||
    url.pathname.replace(/\/$/u, "") !== "/v1beta"
  ) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  const normalizedModelId = modelId.replace(/^models\//u, "");
  if (!normalizedModelId || normalizedModelId.includes("/")) {
    throw new ModelProviderError("INVALID_PROVIDER_ROUTE", false);
  }
  url.pathname = `/v1beta/models/${encodeURIComponent(normalizedModelId)}:generateContent`;
  url.search = "";
  url.hash = "";
  return url;
}

export async function requestGoogleStructured<T>(
  request: StructuredModelRequest<T>,
  fetchImplementation: typeof fetch = fetch,
): Promise<StructuredModelResponse<T>> {
  assertStructuredRequest(request);
  const { payload, response } = await fetchProviderJson(
    generateContentUrl(request.baseUrl, request.modelId),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": request.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: request.maxOutputTokens,
          responseMimeType: "application/json",
          responseJsonSchema: request.jsonSchema,
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMilliseconds ?? 120_000),
    },
    fetchImplementation,
  );
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);
  const candidate = parsed.data.candidates[0];
  if (!candidate) throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    const refusalReasons = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);
    throw new ModelProviderError(
      refusalReasons.has(candidate.finishReason)
        ? "PROVIDER_REFUSAL"
        : "PROVIDER_OUTPUT_INCOMPLETE",
      false,
    );
  }
  const rawOutput = candidate.content.parts
    .map((part) => part.text)
    .filter((text): text is string => Boolean(text))
    .join("");
  if (!rawOutput) throw new ModelProviderError("PROVIDER_RESPONSE_INVALID", false);

  return {
    providerRequestId:
      parsed.data.responseId ?? response.headers.get("x-request-id") ?? "google-response",
    requestedModelId: request.modelId,
    resolvedModelId: parsed.data.modelVersion ?? request.modelId,
    resolvedProvider: "google",
    output: parseStructuredOutput(rawOutput, request.outputSchema),
    rawOutput,
    inputTokens: parsed.data.usageMetadata?.promptTokenCount,
    cachedInputTokens: parsed.data.usageMetadata?.cachedContentTokenCount,
    outputTokens: parsed.data.usageMetadata?.candidatesTokenCount,
    reasoningTokens: parsed.data.usageMetadata?.thoughtsTokenCount,
  };
}
