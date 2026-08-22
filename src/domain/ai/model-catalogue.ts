import { z } from "zod";

import { aiRouteProviderSchema } from "./provider";

export const analysisModelProfileSchema = z.object({
  id: z.string().min(1),
  publisher: z.string().min(1),
  name: z.string().min(1),
  routeProvider: aiRouteProviderSchema,
  providerModelId: z.string().min(1),
  contextLength: z.number().int().positive().optional(),
  promptPricePerMillion: z.number().nonnegative().optional(),
  completionPricePerMillion: z.number().nonnegative().optional(),
  evaluated: z.boolean(),
  sponsorshipEligible: z.boolean(),
  lifecycle: z.enum(["unevaluated", "candidate", "certified", "deprecated", "blocked"]).optional(),
  recommendation: z.enum(["quality", "balanced", "economy"]).optional(),
  evaluationVersion: z.string().optional(),
  supportsStreaming: z.boolean().optional(),
  tasks: z.array(z.enum(["gap_analysis", "verification", "chat"])).optional(),
});

export type AnalysisModelProfile = z.infer<typeof analysisModelProfileSchema>;

export const analysisModelCatalogueSchema = z.object({
  version: z.string().regex(/^[0-9a-f]{64}$/u),
  fetchedAt: z.string().datetime(),
  models: z.array(analysisModelProfileSchema).max(500),
});

export type AnalysisModelCatalogue = z.infer<typeof analysisModelCatalogueSchema>;
