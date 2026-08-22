import { z } from "zod";

const sizeGuidanceSchema = z.object({
  small: z.string().trim().min(1),
  medium: z.string().trim().min(1),
  large: z.string().trim().min(1),
});

const catalogueItemSchema = z.object({
  externalKey: z.string().trim().min(1).max(80),
  regulatoryId: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  legalText: z.string().trim().min(20),
  assessmentAspects: z.array(z.string().trim().min(1)).min(1),
  sourceLocator: z.string().trim().min(1).max(500).optional(),
  sizeGuidance: sizeGuidanceSchema,
  displayOrder: z.number().int().positive(),
});

export const subrequirementSeedSchema = catalogueItemSchema;

export const requirementSeedSchema = catalogueItemSchema.extend({
  subrequirements: z.array(subrequirementSeedSchema),
});

export const frameworkReleaseSeedSchema = z
  .object({
    framework: z.object({
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      region: z.enum(["DE", "EU", "International"]),
      availability: z.enum(["included", "locked"]),
      localizations: z
        .array(
          z.object({
            locale: z.enum(["de", "en"]),
            name: z.string().trim().min(1),
            aliases: z.array(z.string().trim().min(1)),
          }),
        )
        .min(1),
    }),
    release: z.object({
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
    }),
    requirements: z.array(requirementSeedSchema).min(1),
  })
  .superRefine((seed, context) => {
    const localeKeys = seed.framework.localizations.map(({ locale }) => locale);

    if (new Set(localeKeys).size !== localeKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Framework localization locales must be unique.",
        path: ["framework", "localizations"],
      });
    }

    const requirementKeys = seed.requirements.map(({ externalKey }) => externalKey);
    const requirementOrders = seed.requirements.map(({ displayOrder }) => displayOrder);

    if (new Set(requirementKeys).size !== requirementKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Requirement external keys must be unique within a release.",
        path: ["requirements"],
      });
    }

    if (new Set(requirementOrders).size !== requirementOrders.length) {
      context.addIssue({
        code: "custom",
        message: "Requirement display orders must be unique within a release.",
        path: ["requirements"],
      });
    }

    seed.requirements.forEach((requirement, requirementIndex) => {
      const keys = requirement.subrequirements.map(({ externalKey }) => externalKey);
      const orders = requirement.subrequirements.map(({ displayOrder }) => displayOrder);

      if (new Set(keys).size !== keys.length) {
        context.addIssue({
          code: "custom",
          message: "Subrequirement external keys must be unique within a requirement.",
          path: ["requirements", requirementIndex, "subrequirements"],
        });
      }

      if (new Set(orders).size !== orders.length) {
        context.addIssue({
          code: "custom",
          message: "Subrequirement display orders must be unique within a requirement.",
          path: ["requirements", requirementIndex, "subrequirements"],
        });
      }
    });
  });

export type SizeGuidance = z.infer<typeof sizeGuidanceSchema>;
export type SubrequirementSeed = z.infer<typeof subrequirementSeedSchema>;
export type RequirementSeed = z.infer<typeof requirementSeedSchema>;
export type FrameworkReleaseSeed = z.infer<typeof frameworkReleaseSeedSchema>;
