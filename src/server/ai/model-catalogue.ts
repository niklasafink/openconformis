import "server-only";

import { z } from "zod";

import type { AnalysisModelCatalogue, AnalysisModelProfile } from "@/domain/ai/model-catalogue";
import type { AiRouteProvider } from "@/domain/ai/provider";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { aiModelProfiles } from "@/server/db/schema/ai";

import { isStrictAnalysisProviderAvailable } from "./provider-routing";

const openRouterModelsSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        context_length: z.number().int().positive().optional(),
        pricing: z
          .object({
            prompt: z.string().optional(),
            completion: z.string().optional(),
          })
          .optional(),
        supported_parameters: z.array(z.string()).optional(),
        architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
      }),
    )
    .max(2_000),
});

export class ModelCatalogueError extends Error {
  constructor(public readonly code: "MODEL_CATALOGUE_UNAVAILABLE" | "MODEL_CATALOGUE_INVALID") {
    super(code);
    this.name = "ModelCatalogueError";
  }
}

function configuredSet(name: string) {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function pricePerMillion(value?: string) {
  if (!value) return undefined;
  const pricePerToken = Number(value);
  if (!Number.isFinite(pricePerToken) || pricePerToken < 0) return undefined;
  return pricePerToken * 1_000_000;
}

function publisherFromModelId(modelId: string) {
  const publisher = modelId.split("/")[0] || "other";
  return publisher
    .split(/[-_]/u)
    .map((part) => part.charAt(0).toLocaleUpperCase("en") + part.slice(1))
    .join(" ");
}

function displayName(modelId: string) {
  return modelId.split("/").at(-1)?.replaceAll("-", " ") || modelId;
}

function isConfiguredModel(set: Set<string>, provider: AiRouteProvider, modelId: string) {
  return set.has(modelId) || set.has(`${provider}:${modelId}`);
}

function configuredDirectProfiles(): AnalysisModelProfile[] {
  const evaluated = isDatabaseConfigured
    ? new Set<string>()
    : configuredSet("EVALUATED_ANALYSIS_MODEL_ALLOWLIST");
  const definitions: Array<{
    provider: AiRouteProvider;
    environmentName: string;
    publisher?: string;
  }> = [
    {
      provider: "requesty",
      environmentName: "BYOK_REQUESTY_ANALYSIS_MODELS",
    },
    {
      provider: "openai",
      environmentName: "BYOK_OPENAI_ANALYSIS_MODELS",
      publisher: "OpenAI",
    },
  ];
  return definitions.flatMap(({ provider, environmentName, publisher }) => {
    if (!isStrictAnalysisProviderAvailable(provider)) return [];
    return [...configuredSet(environmentName)].map((modelId) => ({
      id: `${provider}:${modelId}`,
      publisher: publisher ?? publisherFromModelId(modelId),
      name: displayName(modelId),
      routeProvider: provider,
      providerModelId: modelId,
      evaluated: isConfiguredModel(evaluated, provider, modelId),
      sponsorshipEligible: false,
    }));
  });
}

function fallbackProfiles(): AnalysisModelProfile[] {
  const configured = [
    process.env.SPONSORED_ANALYSIS_MODEL,
    process.env.DEFAULT_ANALYSIS_MODEL_PROFILE,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const modelIds = configured.length > 0 ? [...new Set(configured)] : ["anthropic/claude-sonnet-5"];
  const evaluated = isDatabaseConfigured
    ? new Set<string>()
    : configuredSet("EVALUATED_ANALYSIS_MODEL_ALLOWLIST");
  const sponsored = configuredSet("SPONSORED_MODEL_ALLOWLIST");
  return modelIds.map((modelId) => ({
    id: `openrouter:${modelId}`,
    publisher: publisherFromModelId(modelId),
    name: displayName(modelId),
    routeProvider: "openrouter",
    providerModelId: modelId,
    evaluated: evaluated.has(modelId),
    sponsorshipEligible: sponsored.has(modelId),
  }));
}

async function curatedProfiles() {
  if (!isDatabaseConfigured) return [];
  const records = await db.select().from(aiModelProfiles).limit(500);
  return records.map((record): AnalysisModelProfile => ({
    id: record.id,
    publisher: record.publisher,
    name: record.displayName,
    routeProvider: record.routeProvider,
    providerModelId: record.providerModelId,
    contextLength: record.contextWindow ?? undefined,
    evaluated: record.lifecycle === "certified",
    sponsorshipEligible: false,
    lifecycle: record.lifecycle,
    recommendation: record.recommendation ?? undefined,
    evaluationVersion: record.evaluationVersion ?? undefined,
    supportsStreaming: record.supportsStreaming,
    tasks: record.tasks as AnalysisModelProfile["tasks"],
  }));
}

function configuredChatProfiles(): AnalysisModelProfile[] {
  const definitions: Array<{
    provider: AiRouteProvider;
    environmentName: string;
    publisher?: string;
  }> = [
    { provider: "requesty", environmentName: "BYOK_REQUESTY_CHAT_MODELS" },
    {
      provider: "anthropic",
      environmentName: "BYOK_ANTHROPIC_CHAT_MODELS",
      publisher: "Anthropic",
    },
    { provider: "google", environmentName: "BYOK_GOOGLE_CHAT_MODELS", publisher: "Google" },
    { provider: "openai", environmentName: "BYOK_OPENAI_CHAT_MODELS", publisher: "OpenAI" },
  ];
  return definitions.flatMap(({ provider, environmentName, publisher }) =>
    [...configuredSet(environmentName)].map((modelId) => ({
      id: `${provider}:${modelId}`,
      publisher: publisher ?? publisherFromModelId(modelId),
      name: displayName(modelId),
      routeProvider: provider,
      providerModelId: modelId,
      evaluated: false,
      sponsorshipEligible: false,
      supportsStreaming: true,
      tasks: ["chat"],
      lifecycle: "unevaluated",
    })),
  );
}

function mergeCuratedProfiles(discovered: AnalysisModelProfile[], curated: AnalysisModelProfile[]) {
  const curatedByRoute = new Map(
    curated.map((model) => [`${model.routeProvider}:${model.providerModelId}`, model]),
  );
  const merged = discovered
    .map((model) => {
      const decision = curatedByRoute.get(`${model.routeProvider}:${model.providerModelId}`);
      return decision ? { ...model, ...decision } : { ...model, lifecycle: "unevaluated" as const };
    })
    .filter((model) => model.lifecycle !== "blocked" && model.lifecycle !== "deprecated")
    .filter((model) => model.tasks?.includes("gap_analysis") ?? true);
  for (const model of curated) {
    if (
      model.lifecycle !== "blocked" &&
      model.lifecycle !== "deprecated" &&
      (model.tasks?.includes("gap_analysis") ?? true) &&
      !merged.some(({ id }) => id === model.id)
    ) {
      merged.push(model);
    }
  }
  return merged;
}

async function responseJson(response: Response) {
  if (!response.ok) throw new ModelCatalogueError("MODEL_CATALOGUE_UNAVAILABLE");
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 5_000_000) throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  const text = await response.text();
  if (text.length > 5_000_000) throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  }
}

export async function getAnalysisModelCatalogue(
  fetchImplementation: typeof fetch = fetch,
): Promise<AnalysisModelCatalogue> {
  const curated = await curatedProfiles();

  if (process.env.MODEL_CATALOGUE_DISCOVERY_DISABLED === "true") {
    const models = mergeCuratedProfiles(
      [...fallbackProfiles(), ...configuredDirectProfiles()],
      curated,
    ).slice(0, 500);
    return {
      version: createContentHash(models),
      fetchedAt: new Date().toISOString(),
      models,
    };
  }

  const url = new URL("https://openrouter.ai/api/v1/models");
  url.searchParams.set("zdr", "true");
  url.searchParams.set("region", "eu");
  url.searchParams.set("supported_parameters", "structured_outputs");

  let payload: unknown;
  try {
    const response = await fetchImplementation(url, {
      cache: "force-cache",
      next: { revalidate: 6 * 60 * 60 },
      signal: AbortSignal.timeout(10_000),
    });
    payload = await responseJson(response);
  } catch (error) {
    if (fetchImplementation !== fetch) throw error;
    const models = mergeCuratedProfiles(
      [...fallbackProfiles(), ...configuredDirectProfiles()],
      curated,
    ).slice(0, 500);
    return {
      version: createContentHash(models),
      fetchedAt: new Date().toISOString(),
      models,
    };
  }

  const parsed = openRouterModelsSchema.safeParse(payload);
  if (!parsed.success) throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  const evaluated = isDatabaseConfigured
    ? new Set<string>()
    : configuredSet("EVALUATED_ANALYSIS_MODEL_ALLOWLIST");
  const sponsored = configuredSet("SPONSORED_MODEL_ALLOWLIST");
  const openRouterModels = parsed.data.data
    .filter(
      (model) =>
        model.supported_parameters?.includes("structured_outputs") &&
        (model.architecture?.output_modalities ?? ["text"]).includes("text"),
    )
    .slice(0, 500)
    .map((model): AnalysisModelProfile => ({
      id: `openrouter:${model.id}`,
      publisher: publisherFromModelId(model.id),
      name: model.name,
      routeProvider: "openrouter",
      providerModelId: model.id,
      contextLength: model.context_length,
      promptPricePerMillion: pricePerMillion(model.pricing?.prompt),
      completionPricePerMillion: pricePerMillion(model.pricing?.completion),
      evaluated: isConfiguredModel(evaluated, "openrouter", model.id),
      sponsorshipEligible: sponsored.has(model.id),
    }))
    .sort(
      (left, right) =>
        Number(right.evaluated) - Number(left.evaluated) ||
        left.publisher.localeCompare(right.publisher, "en") ||
        left.name.localeCompare(right.name, "en"),
    );

  const models = mergeCuratedProfiles([...openRouterModels, ...configuredDirectProfiles()], curated)
    .slice(0, 500)
    .sort(
      (left, right) =>
        Number(right.evaluated) - Number(left.evaluated) ||
        left.publisher.localeCompare(right.publisher, "en") ||
        left.name.localeCompare(right.name, "en") ||
        left.routeProvider.localeCompare(right.routeProvider, "en"),
    );

  const effectiveModels = models.length > 0 ? models : fallbackProfiles();
  return {
    version: createContentHash(effectiveModels),
    fetchedAt: new Date().toISOString(),
    models: effectiveModels,
  };
}

export async function resolveAnalysisModelSelection(input: {
  modelProfileId: string;
  catalogueVersion?: string;
}) {
  const catalogue = await getAnalysisModelCatalogue();
  const model = catalogue.models.find((candidate) => candidate.id === input.modelProfileId);
  if (!model) throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  return { catalogue, model, catalogueChanged: input.catalogueVersion !== catalogue.version };
}

export async function getChatModelCatalogue(): Promise<AnalysisModelCatalogue> {
  const [analysisCatalogue, curated] = await Promise.all([
    getAnalysisModelCatalogue(),
    curatedProfiles(),
  ]);
  const allowedProviders = configuredSet("BYOK_PROVIDER_ALLOWLIST");
  const candidates = [...analysisCatalogue.models, ...configuredChatProfiles(), ...curated]
    .filter((model) => allowedProviders.has(model.routeProvider))
    .filter((model) => model.supportsStreaming !== false)
    .filter((model) => model.tasks?.includes("chat") ?? true);
  const unique = new Map<string, AnalysisModelProfile>();
  for (const model of candidates) {
    const key = `${model.routeProvider}:${model.providerModelId}`;
    const existing = unique.get(key);
    unique.set(key, existing ? { ...existing, ...model } : model);
  }
  const recommendationRank = { quality: 0, balanced: 1, economy: 2 } as const;
  const models = [...unique.values()]
    .filter((model) => model.lifecycle !== "blocked" && model.lifecycle !== "deprecated")
    .sort(
      (left, right) =>
        Number(right.evaluated) - Number(left.evaluated) ||
        (left.recommendation ? recommendationRank[left.recommendation] : 3) -
          (right.recommendation ? recommendationRank[right.recommendation] : 3) ||
        left.publisher.localeCompare(right.publisher, "en") ||
        left.name.localeCompare(right.name, "en"),
    )
    .slice(0, 500);
  return {
    version: createContentHash(models),
    fetchedAt: new Date().toISOString(),
    models,
  };
}

export async function resolveChatModelSelection(input: {
  modelProfileId: string;
  catalogueVersion?: string;
}) {
  const catalogue = await getChatModelCatalogue();
  const model = catalogue.models.find((candidate) => candidate.id === input.modelProfileId);
  if (!model) throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  return { catalogue, model, catalogueChanged: input.catalogueVersion !== catalogue.version };
}
