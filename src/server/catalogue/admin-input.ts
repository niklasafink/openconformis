import { z } from "zod";

import { requirementSeedSchema } from "@/domain/frameworks/release-schema";

export const createFrameworkInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  region: z.enum(["DE", "EU", "International"]),
  availability: z.enum(["included", "locked"]),
  nameDe: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
});

export const createDraftReleaseInputSchema = z.object({
  frameworkSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: z.string().trim().min(1).max(100),
  authoritativeLanguage: z.string().regex(/^[a-z]{2}$/),
  effectiveFrom: z.string().date().optional(),
  effectiveUntil: z.string().date().optional(),
  sourceTitle: z.string().trim().min(1),
  sourceUrl: z.string().url().optional(),
  sourceLocator: z.string().trim().min(1).optional(),
  sourceRetrievedAt: z.string().datetime().optional(),
  contentClassification: z.enum(["demo", "official_source", "derived_mapping"]),
  provenanceNote: z.string().trim().min(1),
  reuseNotice: z.string().trim().min(1),
});

export const saveDraftRequirementInputSchema = z.object({
  releaseId: z.string().uuid(),
  requirementId: z.string().uuid().optional(),
  requirement: requirementSeedSchema,
});

export const releaseIdInputSchema = z.string().uuid();

export type CreateDraftReleaseInput = z.infer<typeof createDraftReleaseInputSchema>;
export type CreateFrameworkInput = z.infer<typeof createFrameworkInputSchema>;
export type SaveDraftRequirementInput = z.infer<typeof saveDraftRequirementInputSchema>;
