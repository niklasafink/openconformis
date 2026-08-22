import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { createContentHash } from "@/domain/frameworks/content-hash";
import { createCatalogueItemHash } from "@/domain/frameworks/release-content";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import {
  regulatoryFrameworkLocalizations,
  regulatoryFrameworkReleases,
  regulatoryFrameworks,
  regulatoryRequirements,
  regulatorySubrequirements,
} from "@/server/db/schema/catalogue";

import {
  createFrameworkInputSchema,
  createDraftReleaseInputSchema,
  releaseIdInputSchema,
  saveDraftRequirementInputSchema,
  type CreateFrameworkInput,
  type CreateDraftReleaseInput,
  type SaveDraftRequirementInput,
} from "./admin-input";
import { requireCatalogueAdministrator } from "./administrator";

export class DraftReleaseRequiredError extends Error {
  constructor() {
    super("Regulatory content can only be changed in a draft release.");
    this.name = "DraftReleaseRequiredError";
  }
}

export async function createRegulatoryFramework(unvalidatedInput: CreateFrameworkInput) {
  const [principal, input] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(createFrameworkInputSchema.parse(unvalidatedInput)),
  ]);

  return db.transaction(async (transaction) => {
    const [framework] = await transaction
      .insert(regulatoryFrameworks)
      .values({
        slug: input.slug,
        region: input.region,
        availability: input.availability,
      })
      .returning({ id: regulatoryFrameworks.id });
    if (!framework) throw new Error("FRAMEWORK_NOT_CREATED");

    await transaction.insert(regulatoryFrameworkLocalizations).values([
      { frameworkId: framework.id, locale: "de", name: input.nameDe },
      { frameworkId: framework.id, locale: "en", name: input.nameEn },
    ]);
    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "catalogue.framework_created",
      targetType: "regulatory_framework",
      targetId: framework.id,
      metadata: { slug: input.slug, region: input.region, availability: input.availability },
    });
    return framework;
  });
}

export class EmptyReleaseError extends Error {
  constructor() {
    super("A framework release needs at least one requirement before publication.");
    this.name = "EmptyReleaseError";
  }
}

export async function createDraftFrameworkRelease(unvalidatedInput: CreateDraftReleaseInput) {
  const [principal, input] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(createDraftReleaseInputSchema.parse(unvalidatedInput)),
  ]);
  const [framework] = await db
    .select({ id: regulatoryFrameworks.id })
    .from(regulatoryFrameworks)
    .where(eq(regulatoryFrameworks.slug, input.frameworkSlug))
    .limit(1);

  if (!framework) {
    throw new Error(`Unknown framework: ${input.frameworkSlug}`);
  }

  return db.transaction(async (transaction) => {
    const [release] = await transaction
      .insert(regulatoryFrameworkReleases)
      .values({
        frameworkId: framework.id,
        version: input.version,
        authoritativeLanguage: input.authoritativeLanguage,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil,
        sourceTitle: input.sourceTitle,
        sourceUrl: input.sourceUrl,
        sourceLocator: input.sourceLocator,
        sourceRetrievedAt: input.sourceRetrievedAt ? new Date(input.sourceRetrievedAt) : undefined,
        contentClassification: input.contentClassification,
        provenanceNote: input.provenanceNote,
        reuseNotice: input.reuseNotice,
      })
      .returning({ id: regulatoryFrameworkReleases.id });

    if (!release) throw new Error("The draft framework release could not be created.");

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "catalogue.release_created",
      targetType: "regulatory_framework_release",
      targetId: release.id,
      metadata: {
        frameworkSlug: input.frameworkSlug,
        version: input.version,
      },
    });

    return release;
  });
}

export async function saveDraftRequirement(unvalidatedInput: SaveDraftRequirementInput) {
  const [principal, input] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(saveDraftRequirementInputSchema.parse(unvalidatedInput)),
  ]);

  return db.transaction(async (transaction) => {
    const [release] = await transaction
      .select({ status: regulatoryFrameworkReleases.status })
      .from(regulatoryFrameworkReleases)
      .where(eq(regulatoryFrameworkReleases.id, input.releaseId))
      .limit(1);

    if (!release || release.status !== "draft") {
      throw new DraftReleaseRequiredError();
    }

    const requirementValues = {
      releaseId: input.releaseId,
      externalKey: input.requirement.externalKey,
      regulatoryId: input.requirement.regulatoryId,
      title: input.requirement.title,
      legalText: input.requirement.legalText,
      assessmentAspects: input.requirement.assessmentAspects,
      sourceLocator: input.requirement.sourceLocator,
      smallInstitutionGuidance: input.requirement.sizeGuidance.small,
      mediumInstitutionGuidance: input.requirement.sizeGuidance.medium,
      largeInstitutionGuidance: input.requirement.sizeGuidance.large,
      displayOrder: input.requirement.displayOrder,
      contentHash: createCatalogueItemHash(input.requirement),
      updatedAt: new Date(),
    } as const;

    let requirementId = input.requirementId;

    if (requirementId) {
      const [updated] = await transaction
        .update(regulatoryRequirements)
        .set(requirementValues)
        .where(
          and(
            eq(regulatoryRequirements.id, requirementId),
            eq(regulatoryRequirements.releaseId, input.releaseId),
          ),
        )
        .returning({ id: regulatoryRequirements.id });

      if (!updated) throw new Error("The requirement does not belong to this draft release.");

      await transaction
        .delete(regulatorySubrequirements)
        .where(eq(regulatorySubrequirements.parentRequirementId, requirementId));
    } else {
      const [inserted] = await transaction
        .insert(regulatoryRequirements)
        .values(requirementValues)
        .returning({ id: regulatoryRequirements.id });
      requirementId = inserted?.id;
    }

    if (!requirementId) throw new Error("The requirement could not be saved.");

    if (input.requirement.subrequirements.length > 0) {
      await transaction.insert(regulatorySubrequirements).values(
        input.requirement.subrequirements.map((subrequirement) => ({
          releaseId: input.releaseId,
          parentRequirementId: requirementId,
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

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: input.requirementId
        ? "catalogue.requirement_updated"
        : "catalogue.requirement_created",
      targetType: "regulatory_requirement",
      targetId: requirementId,
      metadata: {
        releaseId: input.releaseId,
        externalKey: input.requirement.externalKey,
        subrequirementCount: input.requirement.subrequirements.length,
      },
    });

    return { id: requirementId };
  });
}

export async function publishFrameworkRelease(unvalidatedReleaseId: string) {
  const [principal, releaseId] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(releaseIdInputSchema.parse(unvalidatedReleaseId)),
  ]);

  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select id from regulatory_framework_releases where id = ${releaseId} for update`,
    );

    const [release] = await transaction
      .select({
        id: regulatoryFrameworkReleases.id,
        frameworkSlug: regulatoryFrameworks.slug,
        status: regulatoryFrameworkReleases.status,
        version: regulatoryFrameworkReleases.version,
        authoritativeLanguage: regulatoryFrameworkReleases.authoritativeLanguage,
        effectiveFrom: regulatoryFrameworkReleases.effectiveFrom,
        effectiveUntil: regulatoryFrameworkReleases.effectiveUntil,
        sourceTitle: regulatoryFrameworkReleases.sourceTitle,
        sourceUrl: regulatoryFrameworkReleases.sourceUrl,
        sourceLocator: regulatoryFrameworkReleases.sourceLocator,
        sourceRetrievedAt: regulatoryFrameworkReleases.sourceRetrievedAt,
        contentClassification: regulatoryFrameworkReleases.contentClassification,
        provenanceNote: regulatoryFrameworkReleases.provenanceNote,
        reuseNotice: regulatoryFrameworkReleases.reuseNotice,
      })
      .from(regulatoryFrameworkReleases)
      .innerJoin(
        regulatoryFrameworks,
        eq(regulatoryFrameworkReleases.frameworkId, regulatoryFrameworks.id),
      )
      .where(eq(regulatoryFrameworkReleases.id, releaseId))
      .limit(1);

    if (!release || release.status !== "draft") throw new DraftReleaseRequiredError();

    const requirements = await transaction
      .select()
      .from(regulatoryRequirements)
      .where(eq(regulatoryRequirements.releaseId, releaseId))
      .orderBy(asc(regulatoryRequirements.displayOrder));

    if (requirements.length === 0) throw new EmptyReleaseError();

    const subrequirements = await transaction
      .select()
      .from(regulatorySubrequirements)
      .where(eq(regulatorySubrequirements.releaseId, releaseId))
      .orderBy(
        asc(regulatorySubrequirements.parentRequirementId),
        asc(regulatorySubrequirements.displayOrder),
      );

    const contentHash = createContentHash({
      frameworkSlug: release.frameworkSlug,
      release: {
        version: release.version,
        authoritativeLanguage: release.authoritativeLanguage,
        effectiveFrom: release.effectiveFrom,
        effectiveUntil: release.effectiveUntil,
        sourceTitle: release.sourceTitle,
        sourceUrl: release.sourceUrl,
        sourceLocator: release.sourceLocator,
        sourceRetrievedAt: release.sourceRetrievedAt,
        contentClassification: release.contentClassification,
        provenanceNote: release.provenanceNote,
        reuseNotice: release.reuseNotice,
      },
      requirements: requirements.map((requirement) => ({
        externalKey: requirement.externalKey,
        displayOrder: requirement.displayOrder,
        contentHash: requirement.contentHash,
        subrequirements: subrequirements
          .filter((subrequirement) => subrequirement.parentRequirementId === requirement.id)
          .map((subrequirement) => ({
            externalKey: subrequirement.externalKey,
            displayOrder: subrequirement.displayOrder,
            contentHash: subrequirement.contentHash,
          })),
      })),
    });
    const publishedAt = new Date();
    const [published] = await transaction
      .update(regulatoryFrameworkReleases)
      .set({
        status: "published",
        contentHash,
        publishedAt,
        publishedByUserId: principal.userId,
        updatedAt: publishedAt,
      })
      .where(
        and(
          eq(regulatoryFrameworkReleases.id, releaseId),
          eq(regulatoryFrameworkReleases.status, "draft"),
        ),
      )
      .returning({
        id: regulatoryFrameworkReleases.id,
        contentHash: regulatoryFrameworkReleases.contentHash,
      });

    if (!published) throw new DraftReleaseRequiredError();

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "catalogue.release_published",
      targetType: "regulatory_framework_release",
      targetId: releaseId,
      metadata: {
        frameworkSlug: release.frameworkSlug,
        version: release.version,
        contentHash,
        requirementCount: requirements.length,
        subrequirementCount: subrequirements.length,
      },
    });

    return published;
  });
}

export async function archiveFrameworkRelease(unvalidatedReleaseId: string) {
  const [principal, releaseId] = await Promise.all([
    requireCatalogueAdministrator(),
    Promise.resolve(releaseIdInputSchema.parse(unvalidatedReleaseId)),
  ]);
  const archivedAt = new Date();

  return db.transaction(async (transaction) => {
    const [archived] = await transaction
      .update(regulatoryFrameworkReleases)
      .set({ status: "archived", archivedAt, updatedAt: archivedAt })
      .where(
        and(
          eq(regulatoryFrameworkReleases.id, releaseId),
          eq(regulatoryFrameworkReleases.status, "published"),
        ),
      )
      .returning({ id: regulatoryFrameworkReleases.id });

    if (!archived) throw new Error("Only a published release can be archived.");

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "catalogue.release_archived",
      targetType: "regulatory_framework_release",
      targetId: releaseId,
    });

    return archived;
  });
}
