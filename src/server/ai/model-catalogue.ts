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

import { allowedByokProviders } from "./provider-routing";

const openRouterModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  context_length: z.number().int().nonnegative().optional(),
  pricing: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
    })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z.object({ output_modalities: z.array(z.string()).optional() }).optional(),
});

const openRouterModelsSchema = z.object({
  data: z.array(openRouterModelSchema).max(2_000),
});

type OpenRouterModel = z.infer<typeof openRouterModelSchema>;

/**
 * Feste Modellauswahl der Analyse: je ein Modell von Anthropic, OpenAI und
 * Google sowie zwei chinesische Modelle, alle über OpenRouter. Der offene
 * Katalog mit Hunderten Einträgen machte die Wahl beliebig und ließ Routen
 * vorauswählen, für die es keinen Analysepfad gibt.
 */
export const analysisModelShortlist = [
  { modelId: "anthropic/claude-sonnet-5", publisher: "Anthropic", name: "Claude Sonnet 5" },
  { modelId: "openai/gpt-5.5", publisher: "OpenAI", name: "GPT-5.5" },
  { modelId: "google/gemini-3.8-flash", publisher: "Google", name: "Gemini 3.8 Flash" },
  { modelId: "moonshotai/kimi-k3", publisher: "Moonshot AI", name: "Kimi K3" },
  { modelId: "z-ai/glm-5.3", publisher: "Z.ai", name: "GLM 5.3" },
] as const;

type ShortlistEntry = (typeof analysisModelShortlist)[number];

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

/**
 * Das konfigurierte Standardmodell. Es wird nicht nur als Rückfallprofil geführt,
 * sondern entscheidet auch die Vorauswahl im Prüfungsumfang.
 */
function defaultAnalysisModelId() {
  return process.env.DEFAULT_ANALYSIS_MODEL_PROFILE?.trim() || "anthropic/claude-sonnet-5";
}

function shortlistProfile(
  entry: ShortlistEntry,
  discovered?: OpenRouterModel,
): AnalysisModelProfile {
  return {
    id: `openrouter:${entry.modelId}`,
    publisher: entry.publisher,
    name: entry.name,
    routeProvider: "openrouter",
    providerModelId: entry.modelId,
    contextLength: discovered?.context_length || undefined,
    promptPricePerMillion: pricePerMillion(discovered?.pricing?.prompt),
    completionPricePerMillion: pricePerMillion(discovered?.pricing?.completion),
    evaluated: isEvaluated(evaluatedModelIds(), "openrouter", entry.modelId),
  };
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

/** Kuratierte Profile bewerten die Auswahl, fügen aber keine weiteren Modelle hinzu. */
function withCuratedDecisions(models: AnalysisModelProfile[], curated: AnalysisModelProfile[]) {
  const curatedByRoute = new Map(
    curated.map((model) => [`${model.routeProvider}:${model.providerModelId}`, model]),
  );
  return models
    .map((model) => {
      const decision = curatedByRoute.get(`${model.routeProvider}:${model.providerModelId}`);
      return decision ? { ...model, ...decision } : { ...model, lifecycle: "unevaluated" as const };
    })
    .filter(isSelectable);
}

/**
 * Die Oberfläche wählt den ersten Eintrag vor. Ohne diesen Rang gewann ein
 * beliebiges Modell die Standardanalyse, obwohl DEFAULT_ANALYSIS_MODEL_PROFILE
 * ein anderes benennt.
 */
function isDefaultAnalysisModel(model: AnalysisModelProfile) {
  return model.providerModelId === defaultAnalysisModelId();
}

function shortlistRank(model: AnalysisModelProfile) {
  return analysisModelShortlist.findIndex(({ modelId }) => modelId === model.providerModelId);
}

function byEvaluationThenShortlist(left: AnalysisModelProfile, right: AnalysisModelProfile) {
  return (
    Number(right.evaluated) - Number(left.evaluated) ||
    Number(isDefaultAnalysisModel(right)) - Number(isDefaultAnalysisModel(left)) ||
    shortlistRank(left) - shortlistRank(right)
  );
}

function catalogueOf(models: AnalysisModelProfile[]): AnalysisModelCatalogue {
  return { version: createContentHash(models), fetchedAt: new Date().toISOString(), models };
}

/** Auswahlkatalog; bleibt nach Kuratierung nichts übrig, gilt die volle Auswahl. */
function shortlistCatalogue(models: AnalysisModelProfile[], curated: AnalysisModelProfile[]) {
  const selectable = withCuratedDecisions(models, curated);
  const offered =
    selectable.length > 0
      ? selectable
      : analysisModelShortlist.map((entry) => shortlistProfile(entry));
  return catalogueOf(offered.sort(byEvaluationThenShortlist));
}

/** Katalog ohne Anbieterabfrage: die feste Auswahl ohne Preise und Kontextlängen. */
function offlineCatalogue(curated: AnalysisModelProfile[]) {
  return shortlistCatalogue(
    analysisModelShortlist.map((entry) => shortlistProfile(entry)),
    curated,
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
    baseUrl: openRouterBaseUrl(),
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
  const structuredTextModels = new Map(
    parsed.data.data
      .filter(
        (model) =>
          model.supported_parameters?.includes("structured_outputs") &&
          (model.architecture?.output_modalities ?? ["text"]).includes("text"),
      )
      .map((model) => [model.id, model]),
  );

  // Ein Modell der Auswahl, das die Route nicht strukturiert bedienen kann,
  // entfällt: die Schlüsselprüfung würde es ohnehin ablehnen.
  const models = analysisModelShortlist
    .filter(({ modelId }) => structuredTextModels.has(modelId))
    .map((entry) => shortlistProfile(entry, structuredTextModels.get(entry.modelId)));
  return shortlistCatalogue(models, curated);
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
  const allowedProviders = allowedByokProviders();
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
