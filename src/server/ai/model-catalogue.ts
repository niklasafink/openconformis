import "server-only";

import { z } from "zod";

import type { AnalysisModelCatalogue, AnalysisModelProfile } from "@/domain/ai/model-catalogue";
import type { AiRouteProvider } from "@/domain/ai/provider";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { aiModelProfiles } from "@/server/db/schema/ai";
import { configuredSet } from "@/server/environment";

import {
  openRouterBaseUrl,
  openRouterModelsUrl,
  openRouterZeroDataRetention,
} from "./openrouter-route";

import { isAnalysisProviderAvailable } from "./provider-routing";

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

/** Ohne Datenbank kommt der Prüfstatus aus der Umgebung, sonst aus den kuratierten Profilen. */
function evaluatedModelIds() {
  return isDatabaseConfigured
    ? new Set<string>()
    : configuredSet("EVALUATED_ANALYSIS_MODEL_ALLOWLIST");
}

function isEvaluated(evaluated: Set<string>, provider: AiRouteProvider, modelId: string) {
  return evaluated.has(modelId) || evaluated.has(`${provider}:${modelId}`);
}

type ProviderModelList = { provider: AiRouteProvider; environmentName: string; publisher?: string };

function profilesFromEnvironment(
  definitions: ProviderModelList[],
  profile: (provider: AiRouteProvider, modelId: string) => Partial<AnalysisModelProfile>,
): AnalysisModelProfile[] {
  return definitions.flatMap(({ provider, environmentName, publisher }) =>
    [...configuredSet(environmentName)].map((modelId) => ({
      id: `${provider}:${modelId}`,
      publisher: publisher ?? publisherFromModelId(modelId),
      name: displayName(modelId),
      routeProvider: provider,
      providerModelId: modelId,
      evaluated: false,
      ...profile(provider, modelId),
    })),
  );
}

function configuredDirectProfiles() {
  const evaluated = evaluatedModelIds();
  const definitions: ProviderModelList[] = [
    { provider: "requesty", environmentName: "BYOK_REQUESTY_ANALYSIS_MODELS" },
    { provider: "openai", environmentName: "BYOK_OPENAI_ANALYSIS_MODELS", publisher: "OpenAI" },
  ];
  return profilesFromEnvironment(
    definitions.filter(({ provider }) => isAnalysisProviderAvailable(provider)),
    (provider, modelId) => ({ evaluated: isEvaluated(evaluated, provider, modelId) }),
  );
}

function configuredChatProfiles() {
  return profilesFromEnvironment(
    [
      { provider: "requesty", environmentName: "BYOK_REQUESTY_CHAT_MODELS" },
      {
        provider: "anthropic",
        environmentName: "BYOK_ANTHROPIC_CHAT_MODELS",
        publisher: "Anthropic",
      },
      { provider: "google", environmentName: "BYOK_GOOGLE_CHAT_MODELS", publisher: "Google" },
      { provider: "openai", environmentName: "BYOK_OPENAI_CHAT_MODELS", publisher: "OpenAI" },
    ],
    () => ({ supportsStreaming: true, tasks: ["chat"], lifecycle: "unevaluated" }),
  );
}

function fallbackProfiles(): AnalysisModelProfile[] {
  const modelId = process.env.DEFAULT_ANALYSIS_MODEL_PROFILE?.trim() || "anthropic/claude-sonnet-5";
  return [
    {
      id: `openrouter:${modelId}`,
      publisher: publisherFromModelId(modelId),
      name: displayName(modelId),
      routeProvider: "openrouter",
      providerModelId: modelId,
      evaluated: isEvaluated(evaluatedModelIds(), "openrouter", modelId),
    },
  ];
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
    lifecycle: record.lifecycle,
    recommendation: record.recommendation ?? undefined,
    evaluationVersion: record.evaluationVersion ?? undefined,
    supportsStreaming: record.supportsStreaming,
    tasks: record.tasks as AnalysisModelProfile["tasks"],
  }));
}

function isSelectable(model: AnalysisModelProfile) {
  return (
    model.lifecycle !== "blocked" &&
    model.lifecycle !== "deprecated" &&
    (model.tasks?.includes("gap_analysis") ?? true)
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
    .filter(isSelectable);
  for (const model of curated) {
    if (isSelectable(model) && !merged.some(({ id }) => id === model.id)) merged.push(model);
  }
  return merged;
}

function byEvaluationThenName(left: AnalysisModelProfile, right: AnalysisModelProfile) {
  return (
    Number(right.evaluated) - Number(left.evaluated) ||
    left.publisher.localeCompare(right.publisher, "en") ||
    left.name.localeCompare(right.name, "en") ||
    left.routeProvider.localeCompare(right.routeProvider, "en")
  );
}

function catalogueOf(models: AnalysisModelProfile[]): AnalysisModelCatalogue {
  return { version: createContentHash(models), fetchedAt: new Date().toISOString(), models };
}

/** Katalog ohne Anbieterabfrage: konfigurierte Standardmodelle plus kuratierte Profile. */
function offlineCatalogue(curated: AnalysisModelProfile[]) {
  return catalogueOf(
    mergeCuratedProfiles([...fallbackProfiles(), ...configuredDirectProfiles()], curated).slice(
      0,
      500,
    ),
  );
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
  if (process.env.MODEL_CATALOGUE_DISCOVERY_DISABLED === "true") return offlineCatalogue(curated);

  const url = openRouterModelsUrl({
    baseUrl: openRouterBaseUrl() ?? "https://eu.openrouter.ai/api/v1",
    zeroDataRetention: openRouterZeroDataRetention(),
  });

  let payload: unknown;
  try {
    const response = await fetchImplementation(url, {
      cache: "force-cache",
      next: { revalidate: 6 * 60 * 60 },
      signal: AbortSignal.timeout(10_000),
    });
    payload = await responseJson(response);
  } catch (error) {
    // Nur die echte Anbieterabfrage darf still auf den Offline-Katalog zurückfallen;
    // ein Test mit eigener fetch-Implementierung will den Fehler sehen.
    if (fetchImplementation !== fetch) throw error;
    return offlineCatalogue(curated);
  }

  const parsed = openRouterModelsSchema.safeParse(payload);
  if (!parsed.success) throw new ModelCatalogueError("MODEL_CATALOGUE_INVALID");
  const evaluated = evaluatedModelIds();
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
      evaluated: isEvaluated(evaluated, "openrouter", model.id),
    }));

  const models = mergeCuratedProfiles([...openRouterModels, ...configuredDirectProfiles()], curated)
    .slice(0, 500)
    .sort(byEvaluationThenName);
  return catalogueOf(models.length > 0 ? models : fallbackProfiles());
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
  return catalogueOf(models);
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
