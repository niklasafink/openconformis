import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { frameworks } from "@/domain/frameworks/catalog";
import {
  createCatalogueItemHash,
  createFrameworkReleaseHash,
} from "@/domain/frameworks/release-content";
import {
  frameworkReleaseSeedSchema,
  type FrameworkReleaseSeed,
} from "@/domain/frameworks/release-schema";
import { auditEvents } from "@/server/db/schema/application";
import {
  regulatoryFrameworkLocalizations,
  regulatoryFrameworkReleases,
  regulatoryFrameworks,
  regulatoryRequirements,
  regulatorySubrequirements,
} from "@/server/db/schema/catalogue";
import type * as databaseSchema from "@/server/db/schema";

type CatalogueDatabase = PostgresJsDatabase<typeof databaseSchema>;

export type CatalogueSeedReport = {
  frameworkCount: number;
  releaseId: string;
  releaseHash: string;
  requirementCount: number;
  subrequirementCount: number;
  unchanged: boolean;
};

function optionalDate(value: string | undefined) {
  return value ? new Date(value) : undefined;
}

export async function seedRegulatoryCatalogue(
  database: CatalogueDatabase,
  unvalidatedSeed: FrameworkReleaseSeed,
): Promise<CatalogueSeedReport> {
  const seed = frameworkReleaseSeedSchema.parse(unvalidatedSeed);
  const releaseHash = createFrameworkReleaseHash(seed);

  return database.transaction(async (transaction) => {
    for (const framework of frameworks) {
      const [storedFramework] = await transaction
        .insert(regulatoryFrameworks)
        .values({
          slug: framework.id,
          region: framework.region,
          availability: framework.availability,
        })
        .onConflictDoUpdate({
          target: regulatoryFrameworks.slug,
          set: {
            region: framework.region,
            availability: framework.availability,
            updatedAt: new Date(),
          },
        })
        .returning({ id: regulatoryFrameworks.id });

      if (!storedFramework) {
        throw new Error(`Framework ${framework.id} could not be seeded.`);
      }

      for (const locale of ["de", "en"] as const) {
        await transaction
          .insert(regulatoryFrameworkLocalizations)
          .values({
            frameworkId: storedFramework.id,
            locale,
            name: framework.name,
            aliases: [...framework.aliases],
          })
          .onConflictDoUpdate({
            target: [
              regulatoryFrameworkLocalizations.frameworkId,
              regulatoryFrameworkLocalizations.locale,
            ],
            set: {
              name: framework.name,
              aliases: [...framework.aliases],
              updatedAt: new Date(),
            },
          });
      }
    }

    const [framework] = await transaction
      .select({ id: regulatoryFrameworks.id })
      .from(regulatoryFrameworks)
      .where(eq(regulatoryFrameworks.slug, seed.framework.slug))
      .limit(1);

    if (!framework) {
      throw new Error(`Seed framework ${seed.framework.slug} does not exist.`);
    }

    const [existingRelease] = await transaction
      .select({
        id: regulatoryFrameworkReleases.id,
        status: regulatoryFrameworkReleases.status,
        contentHash: regulatoryFrameworkReleases.contentHash,
      })
      .from(regulatoryFrameworkReleases)
      .where(
        and(
          eq(regulatoryFrameworkReleases.frameworkId, framework.id),
          eq(regulatoryFrameworkReleases.version, seed.release.version),
        ),
      )
      .limit(1);

    if (existingRelease && existingRelease.status !== "draft") {
      if (existingRelease.contentHash !== releaseHash) {
        throw new Error(
          `Published release ${seed.framework.slug}/${seed.release.version} differs from the seed. Create a new version instead of mutating history.`,
        );
      }

      return {
        frameworkCount: frameworks.length,
        releaseId: existingRelease.id,
        releaseHash,
        requirementCount: seed.requirements.length,
        subrequirementCount: seed.requirements.reduce(
          (count, requirement) => count + requirement.subrequirements.length,
          0,
        ),
        unchanged: true,
      };
    }

    const releaseValues = {
      frameworkId: framework.id,
      version: seed.release.version,
      authoritativeLanguage: seed.release.authoritativeLanguage,
      effectiveFrom: seed.release.effectiveFrom,
      effectiveUntil: seed.release.effectiveUntil,
      sourceTitle: seed.release.sourceTitle,
      sourceUrl: seed.release.sourceUrl,
      sourceLocator: seed.release.sourceLocator,
      sourceRetrievedAt: optionalDate(seed.release.sourceRetrievedAt),
      contentClassification: seed.release.contentClassification,
      provenanceNote: seed.release.provenanceNote,
      reuseNotice: seed.release.reuseNotice,
      contentHash: releaseHash,
      updatedAt: new Date(),
    } as const;

    let releaseId = existingRelease?.id;

    if (releaseId) {
      await transaction
        .delete(regulatoryRequirements)
        .where(eq(regulatoryRequirements.releaseId, releaseId));
      await transaction
        .update(regulatoryFrameworkReleases)
        .set(releaseValues)
        .where(eq(regulatoryFrameworkReleases.id, releaseId));
    } else {
      const [release] = await transaction
        .insert(regulatoryFrameworkReleases)
        .values(releaseValues)
        .returning({ id: regulatoryFrameworkReleases.id });
      releaseId = release?.id;
    }

    if (!releaseId) {
      throw new Error("The DORA demo release could not be created.");
    }

    for (const requirement of seed.requirements) {
      const [storedRequirement] = await transaction
        .insert(regulatoryRequirements)
        .values({
          releaseId,
          externalKey: requirement.externalKey,
          regulatoryId: requirement.regulatoryId,
          title: requirement.title,
          legalText: requirement.legalText,
          assessmentAspects: requirement.assessmentAspects,
          sourceLocator: requirement.sourceLocator,
          smallInstitutionGuidance: requirement.sizeGuidance.small,
          mediumInstitutionGuidance: requirement.sizeGuidance.medium,
          largeInstitutionGuidance: requirement.sizeGuidance.large,
          displayOrder: requirement.displayOrder,
          contentHash: createCatalogueItemHash(requirement),
        })
        .returning({ id: regulatoryRequirements.id });

      if (!storedRequirement) {
        throw new Error(`Requirement ${requirement.externalKey} could not be seeded.`);
      }

      if (requirement.subrequirements.length > 0) {
        await transaction.insert(regulatorySubrequirements).values(
          requirement.subrequirements.map((subrequirement) => ({
            releaseId,
            parentRequirementId: storedRequirement.id,
            externalKey: subrequirement.externalKey,
            regulatoryId: subrequirement.regulatoryId,
            title: subrequirement.title,
            legalText: subrequirement.legalText,
            assessmentAspects: subrequirement.assessmentAspects,
            sourceLocator: subrequirement.sourceLocator,
            smallInstitutionGuidance: subrequirement.sizeGuidance.small,
            mediumInstitutionGuidance: subrequirement.sizeGuidance.medium,
            largeInstitutionGuidance: subrequirement.sizeGuidance.large,
            displayOrder: subrequirement.displayOrder,
            contentHash: createCatalogueItemHash(subrequirement),
          })),
        );
      }
    }

    const publishedAt = new Date();
    await transaction
      .update(regulatoryFrameworkReleases)
      .set({
        status: "published",
        contentHash: releaseHash,
        publishedAt,
        updatedAt: publishedAt,
      })
      .where(eq(regulatoryFrameworkReleases.id, releaseId));

    await transaction.insert(auditEvents).values({
      action: "catalogue.demo_release_seeded",
      targetType: "regulatory_framework_release",
      targetId: releaseId,
      metadata: {
        frameworkSlug: seed.framework.slug,
        version: seed.release.version,
        contentHash: releaseHash,
        requirementCount: seed.requirements.length,
      },
    });

    return {
      frameworkCount: frameworks.length,
      releaseId,
      releaseHash,
      requirementCount: seed.requirements.length,
      subrequirementCount: seed.requirements.reduce(
        (count, requirement) => count + requirement.subrequirements.length,
        0,
      ),
      unchanged: false,
    };
  });
}
