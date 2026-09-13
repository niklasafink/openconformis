import { z } from "zod";

/**
 * Neustart einer Analyse mit derselben Policy und demselben Umfang — ganz oder als
 * Auswahl daraus —, aber neuem Modell und Schlüssel.
 */
export const analysisRerunInputSchema = z.object({
  modelProfileId: z.string().trim().min(1).max(300),
  modelCatalogueVersion: z.string().trim().min(1).max(128),
  unevaluatedWarningAccepted: z.boolean(),
  apiKey: z.string().trim().min(8).max(20_000),
  /** Nur diese Anforderungen des Ausgangslaufs prüfen; ohne Angabe alle. */
  requirementKeys: z.array(z.string().trim().min(1).max(300)).min(1).max(2000).optional(),
});

export type AnalysisRerunInput = z.infer<typeof analysisRerunInputSchema>;
