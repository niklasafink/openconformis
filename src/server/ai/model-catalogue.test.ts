// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { getAnalysisModelCatalogue } from "./model-catalogue";

describe("analysis model catalogue", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requests and retains only structured text models", async () => {
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
    expect(url.searchParams.get("zdr")).toBeNull();
    expect(url.searchParams.get("supported_parameters")).toBe("structured_outputs");
    expect(catalogue.models).toHaveLength(1);
    expect(catalogue.models[0]).toMatchObject({
      id: "openrouter:anthropic/claude-test",
      publisher: "Anthropic",
      promptPricePerMillion: 3,
      completionPricePerMillion: 15,
    });
  });

  it("tolerates OpenRouter listing a model with context_length 0 instead of failing the whole catalogue", async () => {
    // Reproduziert einen realen Fund gegen die Live-API: einzelne Einträge kamen
    // mit `context_length: 0` statt `null` oder fehlendem Feld, was die vorherige
    // `.positive()`-Prüfung für die gesamte Antwort scheitern ließ — nicht nur für
    // den betroffenen Eintrag.
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
              id: "vendor/broken-context",
              name: "Broken Context",
              context_length: 0,
              supported_parameters: ["structured_outputs"],
              architecture: { output_modalities: ["text"] },
            },
          ],
        }),
      ),
    );

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    expect(catalogue.models).toHaveLength(2);
    const broken = catalogue.models.find(({ id }) => id === "openrouter:vendor/broken-context");
    expect(broken?.contextLength).toBeUndefined();
  });

  it("fails closed for invalid injected responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json"));
    await expect(getAnalysisModelCatalogue(fetchMock)).rejects.toMatchObject({
      code: "MODEL_CATALOGUE_INVALID",
    });
  });

  it("puts the configured default model first so the scope step preselects it", async () => {
    // Reproduziert einen realen Fund: die Oberfläche wählt schlicht den ersten
    // Katalogeintrag vor. Solange kein Modell als geprüft geführt wird, entschied
    // allein die alphabetische Reihenfolge der Anbieter — „anthracite-org" schlug
    // „anthropic" um einen Buchstaben, sodass ein Rollenspiel-Modell die
    // Standardanalyse fuhr, obwohl DEFAULT_ANALYSIS_MODEL_PROFILE ein anderes nennt.
    vi.stubEnv("DEFAULT_ANALYSIS_MODEL_PROFILE", "anthropic/claude-test");
    const model = (id: string, name: string) => ({
      id,
      name,
      context_length: 200000,
      supported_parameters: ["structured_outputs"],
      architecture: { output_modalities: ["text"] },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            model("anthracite-org/magnum-test", "Magnum Test"),
            model("anthropic/claude-test", "Claude Test"),
          ],
        }),
      ),
    );

    const catalogue = await getAnalysisModelCatalogue(fetchMock);
    expect(catalogue.models[0]).toMatchObject({ providerModelId: "anthropic/claude-test" });
    expect(catalogue.models.map(({ providerModelId }) => providerModelId)).toContain(
      "anthracite-org/magnum-test",
    );
  });

  it("adds only direct routes configured for the model catalogue", async () => {
    vi.stubEnv("BYOK_REQUESTY_ANALYSIS_MODELS", "anthropic/claude-test");
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
