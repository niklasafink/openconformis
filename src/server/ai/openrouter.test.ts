// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ModelProviderError, requestOpenRouterStructured } from "./openrouter";

const outputSchema = z.object({ answer: z.string() });

describe("OpenRouter EU structured adapter", () => {
  it("enforces the frozen privacy and structured-output request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation-1",
          model: "provider/model-v1",
          provider: "eu-provider",
          choices: [{ message: { content: JSON.stringify({ answer: "ok" }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await requestOpenRouterStructured(
      {
        apiKey: "test-key",
        baseUrl: "https://eu.openrouter.ai/api/v1",
        modelId: "provider/model-v1",
        system: "system",
        user: "user",
        schemaName: "answer",
        jsonSchema: { type: "object" },
        outputSchema,
        providerOnly: ["eu-provider"],
        maxOutputTokens: 1_000,
      },
      fetchMock,
    );

    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String((request?.[1] as RequestInit | undefined)?.body)) as {
      provider: Record<string, unknown>;
      max_tokens: number;
      response_format: { json_schema: { strict: boolean } };
    };
    expect(request?.[0].toString()).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
    expect(body.provider).toEqual({
      only: ["eu-provider"],
      allow_fallbacks: false,
      require_parameters: true,
      data_collection: "deny",
      zdr: true,
    });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_tokens).toBe(1_000);
    expect(response.output).toEqual({ answer: "ok" });
    expect(response.costMicrounits).toBe(1000);
  });

  it("rejects a non-EU endpoint before sending policy data", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      requestOpenRouterStructured(
        {
          apiKey: "test-key",
          baseUrl: "https://openrouter.ai/api/v1",
          modelId: "provider/model-v1",
          system: "system",
          user: "user",
          schemaName: "answer",
          jsonSchema: { type: "object" },
          outputSchema,
          providerOnly: ["provider"],
          maxOutputTokens: 1_000,
        },
        fetchMock,
      ),
    ).rejects.toEqual(new ModelProviderError("INVALID_EU_ROUTE", false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retry an invalid model response inside the adapter", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation-2",
          model: "provider/model-v1",
          choices: [{ message: { content: JSON.stringify({ wrong: true }) } }],
        }),
        { status: 200 },
      ),
    );

    await expect(
      requestOpenRouterStructured(
        {
          apiKey: "test-key",
          baseUrl: "https://eu.openrouter.ai/api/v1",
          modelId: "provider/model-v1",
          system: "system",
          user: "user",
          schemaName: "answer",
          jsonSchema: { type: "object" },
          outputSchema,
          providerOnly: ["provider"],
          maxOutputTokens: 1_000,
        },
        fetchMock,
      ),
    ).rejects.toEqual(new ModelProviderError("MODEL_OUTPUT_INVALID", false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
