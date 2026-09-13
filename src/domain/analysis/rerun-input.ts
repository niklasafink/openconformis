import { z } from "zod";

/** Neustart einer Analyse mit derselben Policy und demselben Umfang, aber neuem Modell und Schlüssel. */
export const analysisRerunInputSchema = z.object({
  modelProfileId: z.string().trim().min(1).max(300),
  modelCatalogueVersion: z.string().trim().min(1).max(128),
  unevaluatedWarningAccepted: z.boolean(),
  apiKey: z.string().trim().min(8).max(20_000),
});

export type AnalysisRerunInput = z.infer<typeof analysisRerunInputSchema>;
