// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { CredentialValidationError, validateProviderCredential } from "./credential-validation";

describe("provider credential validation", () => {
  it("validates an Anthropic key without putting it in the URL", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "claude-sonnet-4-6" })));

    await expect(
      validateProviderCredential(
        {
          provider: "anthropic",
          secret: "secret-canary",
          requiredModelId: "claude-sonnet-4-6",
        },
        fetchMock,
      ),
    ).resolves.toMatchObject({ accessibleModelIds: ["claude-sonnet-4-6"] });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("secret-canary");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("secret-canary");
    expect(new Headers(init?.headers).get("anthropic-version")).toBe("2023-06-01");
  });

  it("sends Google keys only in x-goog-api-key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ name: "models/gemini-3.5-flash" })));

    await validateProviderCredential(
      { provider: "google", secret: "google-canary", requiredModelId: "gemini-3.5-flash" },
      fetchMock,
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("google-canary");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("google-canary");
  });

  it("requires the exact EU/ZDR OpenRouter model", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { label: "Temporary analysis" } })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "anthropic/claude-sonnet-4.6",
                supported_parameters: ["structured_outputs"],
              },
            ],
          }),
        ),
      );

    const result = await validateProviderCredential(
      {
        provider: "openrouter",
        secret: "router-canary",
        requiredModelId: "anthropic/claude-sonnet-4.6",
      },
      fetchMock,
    );

    const modelsUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(modelsUrl.hostname).toBe("eu.openrouter.ai");
    expect(modelsUrl.searchParams.get("zdr")).toBe("true");
    expect(modelsUrl.searchParams.get("region")).toBe("eu");
    expect(result.safeLabel).toBe("Temporary analysis");
  });

  it("returns only safe error codes for rejected credentials", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("denied", { status: 401 }));

    await expect(
      validateProviderCredential(
        { provider: "openai", secret: "secret-canary", requiredModelId: "gpt-5.4" },
        fetchMock,
      ),
    ).rejects.toEqual(new CredentialValidationError("CREDENTIAL_REJECTED", false));
  });

  it("validates Requesty and OpenAI credentials only through EU endpoints", async () => {
    const requestyFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "anthropic/claude-test" }] })));
    await validateProviderCredential(
      {
        provider: "requesty",
        secret: "requesty-canary",
        requiredModelId: "anthropic/claude-test",
      },
      requestyFetch,
    );
    expect(String(requestyFetch.mock.calls[0]?.[0])).toBe(
      "https://router.eu.requesty.ai/v1/models",
    );

    const openAiFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "gpt-test" })));
    await validateProviderCredential(
      { provider: "openai", secret: "openai-canary", requiredModelId: "gpt-test" },
      openAiFetch,
    );
    expect(String(openAiFetch.mock.calls[0]?.[0])).toBe(
      "https://eu.api.openai.com/v1/models/gpt-test",
    );
  });
});
