// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { analysisModelShortlist, getAnalysisModelCatalogue } from "./model-catalogue";

function structuredTextModel(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    context_length: 200000,
    supported_parameters: ["structured_outputs"],
    architecture: { output_modalities: ["text"] },
    ...extra,
  };
}

function catalogueResponse(data: unknown[]) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data })));
}

describe("analysis model catalogue", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers only shortlisted models that the route serves as structured text", async () => {
    const fetchMock = catalogueResponse([
      structuredTextModel("anthropic/claude-sonnet-5", {
        pricing: { prompt: "0.000003", completion: "0.000015" },
      }),
      { id: "openai/gpt-5.5", name: "GPT-5.5", supported_parameters: ["response_format"] },
      structuredTextModel("google/gemini-3.8-flash", {
        architecture: { output_modalities: ["image"] },
      }),
      structuredTextModel("vendor/not-shortlisted"),
    ]);

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("zdr")).toBeNull();
    expect(url.searchParams.get("supported_parameters")).toBe("structured_outputs");
    expect(catalogue.models).toHaveLength(1);
    expect(catalogue.models[0]).toMatchObject({
      id: "openrouter:anthropic/claude-sonnet-5",
      publisher: "Anthropic",
      name: "Claude Sonnet 5",
      promptPricePerMillion: 3,
      completionPricePerMillion: 15,
    });
  });

  it("offers at most five OpenRouter models even when more are listed", async () => {
    vi.stubEnv("BYOK_OPENAI_ANALYSIS_MODELS", "gpt-test");
    const fetchMock = catalogueResponse([
      ...analysisModelShortlist.map(({ modelId }) => structuredTextModel(modelId)),
      structuredTextModel("anthropic/claude-opus-5"),
      structuredTextModel("deepseek/deepseek-v4-pro"),
    ]);

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    expect(catalogue.models.map(({ providerModelId }) => providerModelId)).toEqual(
      analysisModelShortlist.map(({ modelId }) => modelId),
    );
    expect(catalogue.models.every(({ routeProvider }) => routeProvider === "openrouter")).toBe(
      true,
    );
  });

  it("tolerates OpenRouter listing a model with context_length 0 instead of failing the whole catalogue", async () => {
    // Reproduziert einen realen Fund gegen die Live-API: einzelne Einträge kamen
    // mit `context_length: 0` statt `null` oder fehlendem Feld, was die vorherige
    // `.positive()`-Prüfung für die gesamte Antwort scheitern ließ — nicht nur für
    // den betroffenen Eintrag.
    const fetchMock = catalogueResponse([
      structuredTextModel("anthropic/claude-sonnet-5"),
      structuredTextModel("z-ai/glm-5.3", { context_length: 0 }),
    ]);

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    expect(catalogue.models).toHaveLength(2);
    const broken = catalogue.models.find(({ id }) => id === "openrouter:z-ai/glm-5.3");
    expect(broken?.contextLength).toBeUndefined();
  });

  it("fails closed for invalid injected responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json"));
    await expect(getAnalysisModelCatalogue(fetchMock)).rejects.toMatchObject({
      code: "MODEL_CATALOGUE_INVALID",
    });
  });

  it("puts the configured default model first so the scope step preselects it", async () => {
    vi.stubEnv("DEFAULT_ANALYSIS_MODEL_PROFILE", "z-ai/glm-5.3");
    const fetchMock = catalogueResponse(
      analysisModelShortlist.map(({ modelId }) => structuredTextModel(modelId)),
    );

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    expect(catalogue.models[0]).toMatchObject({ providerModelId: "z-ai/glm-5.3" });
  });

  it("falls back to the full shortlist when the route lists none of its models", async () => {
    const catalogue = await getAnalysisModelCatalogue(catalogueResponse([]));
    expect(catalogue.models).toHaveLength(analysisModelShortlist.length);
    expect(catalogue.models[0]).toMatchObject({ providerModelId: "openai/gpt-5.6-luna" });
  });
});
