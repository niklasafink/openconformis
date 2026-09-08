import { z } from "zod";

export const analysisStartInputSchema = z.object({
  draftId: z.uuid(),
  credentialId: z.uuid(),
});

export type AnalysisStartInput = z.infer<typeof analysisStartInputSchema>;
