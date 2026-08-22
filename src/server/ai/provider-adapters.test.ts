// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { requestAnthropicStructured } from "./anthropic";
import { requestGoogleStructured } from "./google";
import { requestOpenAiStructured } from "./openai";
import {
  getStrictAnalysisProviderConfiguration,
  isStrictAnalysisProviderAvailable,
  ProviderRouteConfigurationError,
} from "./provider-routing";
import { requestRequestyStructured } from "./requesty";
import { ModelProviderError } from "./structured-model";

const outputSchema = z.object({ answer: z.string() });

function request(baseUrl: string) {
  return {
    apiKey: "secret-canary",
    baseUrl,
    modelId: "test-model",
    system: "system",
    user: "user",
    schemaName: "answer",
    jsonSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    outputSchema,
    maxOutputTokens: 1_000,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("direct structured-output adapters", () => {
  it("uses the OpenAI EU Responses endpoint without persistent response state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_1",
          model: "gpt-test-2026-01-01",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify({ answer: "ok" }) }],
            },
          ],
          usage: {
            input_tokens: 50,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens: 12,
            output_tokens_details: { reasoning_tokens: 4 },
          },
        }),
      ),
    );

    const result = await requestOpenAiStructured(
      { ...request("https://eu.api.openai.com/v1"), modelId: "gpt-test" },
      fetchMock,
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(String(url)).toBe("https://eu.api.openai.com/v1/responses");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-canary");
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty("temperature");
    expect(result).toMatchObject({
      output: { answer: "ok" },
      cachedInputTokens: 20,
      reasoningTokens: 4,
    });
  });

  it("uses Anthropic native JSON outputs and records cache and thinking tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_1",
          model: "claude-test",
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ answer: "ok" }) }],
          usage: {
            input_tokens: 80,
            cache_read_input_tokens: 60,
            output_tokens: 14,
            output_tokens_details: { thinking_tokens: 5 },
          },
        }),
      ),
    );

    const result = await requestAnthropicStructured(
      { ...request("https://api.anthropic.com/v1"), modelId: "claude-test" },
      fetchMock,
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      output_config: { format: { type: string } };
    };
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("secret-canary");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(result).toMatchObject({ cachedInputTokens: 60, reasoningTokens: 5 });
  });

  it("uses Gemini responseJsonSchema and keeps the key out of the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          responseId: "gemini_1",
          modelVersion: "gemini-test-001",
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify({ answer: "ok" }) }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 70,
            cachedContentTokenCount: 30,
            candidatesTokenCount: 10,
            thoughtsTokenCount: 3,
          },
        }),
      ),
    );

    const result = await requestGoogleStructured(
      { ...request("https://generativelanguage.googleapis.com/v1beta"), modelId: "gemini-test" },
      fetchMock,
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      generationConfig: { responseMimeType: string; responseJsonSchema: object };
    };
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(String(url)).not.toContain("secret-canary");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("secret-canary");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(result).toMatchObject({ cachedInputTokens: 30, reasoningTokens: 3 });
  });

  it("uses Requesty's EU Responses endpoint and normalizes its cost", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "req_1",
          model: "anthropic/claude-test",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: JSON.stringify({ answer: "ok" }) }],
            },
          ],
          usage: { input_tokens: 40, output_tokens: 8, cost: 0.00125 },
        }),
      ),
    );

    const result = await requestRequestyStructured(
      {
        ...request("https://router.eu.requesty.ai/v1"),
        modelId: "anthropic/claude-test",
      },
      fetchMock,
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(String(url)).toBe("https://router.eu.requesty.ai/v1/responses");
    expect(body.store).toBe(false);
    expect(result.costMicrounits).toBe(1_250);
  });

  it("rejects substitute hosts before any policy content is sent", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      requestOpenAiStructured(request("https://eu.api.openai.com.example/v1"), fetchMock),
    ).rejects.toEqual(new ModelProviderError("INVALID_EU_ROUTE", false));
    await expect(
      requestRequestyStructured(request("https://router.requesty.ai/v1"), fetchMock),
    ).rejects.toEqual(new ModelProviderError("INVALID_EU_ROUTE", false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes network failures without leaking provider details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret upstream detail"));
    await expect(
      requestOpenAiStructured(request("https://eu.api.openai.com/v1"), fetchMock),
    ).rejects.toEqual(new ModelProviderError("PROVIDER_HTTP_ERROR", true));
  });
});

describe("strict EU and ZDR provider policy", () => {
  it("keeps direct Anthropic and Google routes unavailable", () => {
    expect(isStrictAnalysisProviderAvailable("anthropic")).toBe(false);
    expect(isStrictAnalysisProviderAvailable("google")).toBe(false);
    expect(() => getStrictAnalysisProviderConfiguration("anthropic")).toThrow(
      new ProviderRouteConfigurationError("STRICT_PRIVACY_ROUTE_UNAVAILABLE"),
    );
  });

  it("enables only explicitly qualified Requesty and OpenAI profiles", () => {
    vi.stubEnv("BYOK_REQUESTY_EU_ZDR_ENABLED", "true");
    vi.stubEnv("BYOK_OPENAI_EU_ZDR_ENABLED", "true");
    expect(getStrictAnalysisProviderConfiguration("requesty").baseUrl).toBe(
      "https://router.eu.requesty.ai/v1",
    );
    expect(getStrictAnalysisProviderConfiguration("openai").baseUrl).toBe(
      "https://eu.api.openai.com/v1",
    );
  });
});
