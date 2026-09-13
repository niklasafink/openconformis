// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ModelProviderError, requestOpenRouterStructured } from "./openrouter";

const outputSchema = z.object({ answer: z.string() });

describe("OpenRouter structured adapter", () => {
  it("sends the pinned provider and the strict schema, and asks for retention only when required", async () => {
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
        zeroDataRetention: true,
        maxOutputTokens: 1_000,
        reasoningEffort: "low",
      },
      fetchMock,
    );

    const request = fetchMock.mock.calls[0];
    const body = JSON.parse(String((request?.[1] as RequestInit | undefined)?.body)) as {
      provider: Record<string, unknown>;
      max_tokens: number;
      reasoning: unknown;
      response_format: { json_schema: { strict: boolean } };
    };
    expect(request?.[0].toString()).toBe("https://eu.openrouter.ai/api/v1/chat/completions");
    expect(body.provider).toEqual({
      only: ["eu-provider"],
      allow_fallbacks: false,
      data_collection: "deny",
      zdr: true,
    });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_tokens).toBe(1_000);
    // Denk-Tokens zählen zum Limit und bestimmen die Dauer; der Denktext wird nicht gebraucht.
    expect(body.reasoning).toEqual({ effort: "low", exclude: true });
    expect(response.output).toEqual({ answer: "ok" });
    expect(response.costMicrounits).toBe(1000);
  });

  it("omits the retention constraints when they are not requested, so routing stays open", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation-3",
          model: "provider/model-v1",
          choices: [{ message: { content: JSON.stringify({ answer: "ok" }) } }],
        }),
        { status: 200 },
      ),
    );

    await requestOpenRouterStructured(
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
        zeroDataRetention: false,
        maxOutputTokens: 1_000,
      },
      fetchMock,
    );

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { provider: Record<string, unknown> };
    expect(body.provider).not.toHaveProperty("zdr");
    expect(body.provider).not.toHaveProperty("data_collection");
    expect(body).not.toHaveProperty("reasoning");
  });

  it("routes without a pinned provider, which BYOK requires", async () => {
    // Die Datenbank verlangt fuer BYOK eine leere Anbieterliste
    // (analyses_provider_route_check); der Adapter verlangte frueher eine
    // gefuellte, wodurch BYOK ueber OpenRouter unmoeglich war.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation-5",
          model: "provider/model-v1",
          choices: [{ message: { content: JSON.stringify({ answer: "ok" }) } }],
        }),
        { status: 200 },
      ),
    );

    await requestOpenRouterStructured(
      {
        apiKey: "test-key",
        baseUrl: "https://openrouter.ai/api/v1",
        modelId: "provider/model-v1",
        system: "system",
        user: "user",
        schemaName: "answer",
        jsonSchema: { type: "object" },
        outputSchema,
        providerOnly: [],
        maxOutputTokens: 1_000,
      },
      fetchMock,
    );

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { provider: Record<string, unknown> };
    expect(body.provider).not.toHaveProperty("only");
    expect(body.provider.allow_fallbacks).toBe(true);
  });

  it("refuses a base URL outside OpenRouter before sending policy data", async () => {
    // Die Hostliste bleibt geschlossen: der Betreiber wählt zwischen EU- und
    // Standardroute, aber die Policy darf niemals an einen fremden Host gehen.
    const fetchMock = vi.fn<typeof fetch>();
    for (const baseUrl of [
      "https://evil.example/api/v1",
      "http://openrouter.ai/api/v1",
      "https://openrouter.ai.evil.example/api/v1",
    ]) {
      await expect(
        requestOpenRouterStructured(
          {
            apiKey: "test-key",
            baseUrl,
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
      ).rejects.toBeInstanceOf(ModelProviderError);
    }
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
    ).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a truncated answer as an output limit, not a schema violation", async () => {
    // Sonnet 5 lief bei 4000 Tokens regelmässig gegen die Decke; die abgeschnittene
    // Antwort erschien als "kein gültiges Ergebnis nach dem Schema" und verdeckte,
    // dass nur das Limit zu niedrig war.
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation-4",
          model: "provider/model-v1",
          choices: [{ message: { content: '{"answer": "abgeschn' }, finish_reason: "length" }],
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
          maxOutputTokens: 4_000,
        },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_INCOMPLETE", retryable: false });
  });
});

describe("OpenRouter response diagnostics", () => {
  function requestWith(body: unknown) {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    return requestOpenRouterStructured(
      {
        apiKey: "test-key",
        baseUrl: "https://openrouter.ai/api/v1",
        modelId: "anthropic/claude-sonnet-5",
        system: "system",
        user: "user",
        schemaName: "answer",
        jsonSchema: { type: "object" },
        outputSchema,
        maxOutputTokens: 12_000,
      },
      fetchMock,
    );
  }

  it("reads an abort that arrives as HTTP 200 and leaves it retryable", async () => {
    // Ein Verifikationsaufruf brach nach 40 Sekunden so ab; der Lauf meldete nur
    // „nicht auswertbar" und endete, obwohl der Anbieter den Grund mitschickte.
    await expect(
      requestWith({ error: { code: 502, message: "Upstream provider overloaded" } }),
    ).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
      retryable: true,
      detail: expect.stringContaining("Upstream provider overloaded"),
    });
  });

  it("names the provider reason when a choice ends in an error without content", async () => {
    await expect(
      requestWith({
        id: "gen-5",
        model: "anthropic/claude-sonnet-5",
        provider: "Anthropic",
        choices: [
          {
            message: { content: null },
            finish_reason: "error",
            error: { message: "Internal server error" },
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
      retryable: true,
      detail: expect.stringMatching(/Anthropic: Internal server error \(Anfrage gen-5\)/u),
    });
  });

  it("states finish reason and request id for an empty answer", async () => {
    await expect(
      requestWith({
        id: "gen-6",
        model: "anthropic/claude-sonnet-5",
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      retryable: true,
      detail: expect.stringMatching(/finish_reason: stop.*gen-6/u),
    });
  });

  it("names the fields that break the expected response format", async () => {
    await expect(
      requestWith({ id: "gen-7", model: "anthropic/claude-sonnet-5", choices: [] }),
    ).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_INVALID",
      detail: expect.stringContaining("choices"),
    });
  });
});
