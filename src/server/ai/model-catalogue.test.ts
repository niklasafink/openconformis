// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { getAnalysisModelCatalogue } from "./model-catalogue";

describe("analysis model catalogue", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requests and retains only EU/ZDR structured text models", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "anthropic/claude-test",
              name: "Claude Test",
              context_length: 200000,
              pricing: { prompt: "0.000003", completion: "0.000015" },
              supported_parameters: ["structured_outputs"],
              architecture: { output_modalities: ["text"] },
            },
            {
              id: "vendor/image-test",
              name: "Image Test",
              supported_parameters: ["structured_outputs"],
              architecture: { output_modalities: ["image"] },
            },
            {
              id: "vendor/json-only",
              name: "JSON only",
              supported_parameters: ["response_format"],
            },
          ],
        }),
      ),
    );

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("zdr")).toBe("true");
    expect(url.searchParams.get("region")).toBe("eu");
    expect(url.searchParams.get("supported_parameters")).toBe("structured_outputs");
    expect(catalogue.models).toHaveLength(1);
    expect(catalogue.models[0]).toMatchObject({
      id: "openrouter:anthropic/claude-test",
      publisher: "Anthropic",
      promptPricePerMillion: 3,
      completionPricePerMillion: 15,
    });
  });

  it("fails closed for invalid injected responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json"));
    await expect(getAnalysisModelCatalogue(fetchMock)).rejects.toMatchObject({
      code: "MODEL_CATALOGUE_INVALID",
    });
  });

  it("adds only direct routes explicitly qualified for the strict privacy profile", async () => {
    vi.stubEnv("BYOK_REQUESTY_EU_ZDR_ENABLED", "true");
    vi.stubEnv("BYOK_REQUESTY_ANALYSIS_MODELS", "anthropic/claude-test");
    vi.stubEnv("BYOK_OPENAI_EU_ZDR_ENABLED", "true");
    vi.stubEnv("BYOK_OPENAI_ANALYSIS_MODELS", "gpt-test");
    vi.stubEnv(
      "EVALUATED_ANALYSIS_MODEL_ALLOWLIST",
      "requesty:anthropic/claude-test,openai:gpt-test",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })));

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    expect(catalogue.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "requesty:anthropic/claude-test",
          routeProvider: "requesty",
          evaluated: true,
        }),
        expect.objectContaining({
          id: "openai:gpt-test",
          routeProvider: "openai",
          evaluated: true,
        }),
      ]),
    );
    expect(catalogue.models.some(({ routeProvider }) => routeProvider === "anthropic")).toBe(false);
    expect(catalogue.models.some(({ routeProvider }) => routeProvider === "google")).toBe(false);
  });
});
