// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChatModel } from "./chat-stream";

function streamResponse(events: unknown[]) {
  return new Response(
    events.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("") + "data: [DONE]\n\n",
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

async function collect(iterator: ReturnType<typeof streamChatModel>) {
  let content = "";
  while (true) {
    const next = await iterator.next();
    if (next.done) return { content, metadata: next.value };
    content += next.value;
  }
}

describe("provider-neutral chat streaming", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes OpenRouter deltas and freezes the configured upstream route", async () => {
    vi.stubEnv("OPENROUTER_CHAT_PROVIDER_ONLY", "Google");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([
        { id: "req-1", choices: [{ delta: { content: "Hallo" } }] },
        {
          choices: [{ delta: { content: " [1]" } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        },
      ]),
    );
    const result = await collect(
      streamChatModel(
        {
          configuration: {
            provider: "openrouter",
            baseUrl: "https://eu.openrouter.ai/api/v1",
            maxOutputTokens: 1000,
            privacyProfileId: "eu-zdr-v1",
          },
          apiKey: "secret-key",
          modelId: "google/model",
          system: "System",
          messages: [{ role: "user", content: "Frage" }],
        },
        fetchMock,
      ),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      provider: { only: string[]; allow_fallbacks: boolean; zdr: boolean };
    };
    expect(body.provider).toEqual(
      expect.objectContaining({ only: ["Google"], allow_fallbacks: false, zdr: true }),
    );
    expect(result).toEqual({
      content: "Hallo [1]",
      metadata: expect.objectContaining({
        providerRequestId: "req-1",
        inputTokens: 12,
        outputTokens: 4,
      }),
    });
  });

  it("normalizes OpenAI Responses API events without persisting provider state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([
        { type: "response.created", response: { id: "resp-1" } },
        { type: "response.output_text.delta", delta: "Antwort [1]" },
        {
          type: "response.completed",
          response: { id: "resp-1", usage: { input_tokens: 9, output_tokens: 3 } },
        },
      ]),
    );
    const result = await collect(
      streamChatModel(
        {
          configuration: {
            provider: "openai",
            baseUrl: "https://eu.api.openai.com/v1",
            maxOutputTokens: 1000,
            privacyProfileId: "eu-zdr-v1",
          },
          apiKey: "secret-key",
          modelId: "gpt-test",
          system: "System",
          messages: [{ role: "user", content: "Frage" }],
        },
        fetchMock,
      ),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { store: boolean };
    expect(body.store).toBe(false);
    expect(result.content).toBe("Antwort [1]");
    expect(result.metadata).toEqual(
      expect.objectContaining({ providerRequestId: "resp-1", inputTokens: 9, outputTokens: 3 }),
    );
  });
});
