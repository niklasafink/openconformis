// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { SystemOneQuestion } from "@/domain/ai/system-one";

import { ModelProviderError } from "./structured-model";
import { requestSystemOne } from "./typesafe";

const terminationQuestion: SystemOneQuestion = {
  type: "noul",
  instructions: "Does the contract allow termination for cause?",
  criteria: {
    true: "The contract grants a right of termination for cause.",
    false: "The contract grants no such right or is silent.",
  },
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function answeredOnce() {
  return jsonResponse({
    model: "jev-1.13.0",
    answers: { termination: { type: "noul", noul: 0.91 } },
    usage: { input_tokens: 4200, output_tokens: 3 },
  });
}

describe("TypeSafe System One adapter", () => {
  it("posts the typed question to the systemone route and returns the typed answer", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(answeredOnce());

    const result = await requestSystemOne(
      {
        apiKey: "test-key",
        state: "Der Vertrag kann aus wichtigem Grund gekündigt werden.",
        questions: { termination: terminationQuestion },
      },
      fetchMock,
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");

    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(sent.model).toBe("jev-latest");
    // Der Zustand bleibt der deutsche Originaltext, die Frage ist englisch.
    expect(sent.state).toBe("Der Vertrag kann aus wichtigem Grund gekündigt werden.");
    expect(sent.questions).toEqual({ termination: terminationQuestion });

    expect(result.answers.termination).toEqual({ type: "noul", noul: 0.91 });
    expect(result.resolvedModelId).toBe("jev-1.13.0");
    expect(result.inputTokens).toBe(4200);
  });

  it("refuses a base URL that does not belong to TypeSafe before sending the key", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      requestSystemOne(
        {
          apiKey: "test-key",
          baseUrl: "https://api.typesafe.ai.evil.example/v1",
          state: "text",
          questions: { termination: terminationQuestion },
        },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_ROUTE", retryable: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "PROVIDER_CREDENTIAL_INVALID", false],
    [422, "PROVIDER_REQUEST_INVALID", false],
    [429, "PROVIDER_RATE_LIMITED", true],
    [529, "PROVIDER_UNAVAILABLE", true],
  ])("maps HTTP %i to %s", async (status, code, retryable) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { message: "provider said so" } }, { status: status as number }),
      );

    await expect(
      requestSystemOne(
        { apiKey: "test-key", state: "text", questions: { termination: terminationQuestion } },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code, retryable });
  });

  it("carries the retry delay the provider asked for", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "7" },
      }),
    );

    const error = await requestSystemOne(
      { apiKey: "test-key", state: "text", questions: { termination: terminationQuestion } },
      fetchMock,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ModelProviderError);
    expect((error as ModelProviderError).retryAfterSeconds).toBe(7);
  });

  it("rejects a question the provider did not answer instead of treating it as no finding", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ model: "jev-1.13.0", answers: {} }));

    await expect(
      requestSystemOne(
        { apiKey: "test-key", state: "text", questions: { termination: terminationQuestion } },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
  });

  it("rejects a malformed question before it reaches the provider", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      requestSystemOne(
        {
          apiKey: "test-key",
          state: "text",
          questions: {
            // Eine Auswahl mit einer einzigen Option ist keine Entscheidung.
            law: { type: "choice", instructions: "Which law governs?", criteria: { de: "German" } },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_REQUEST_INVALID", retryable: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send an empty key", async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      requestSystemOne(
        { apiKey: "   ", state: "text", questions: { termination: terminationQuestion } },
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_ROUTE" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
