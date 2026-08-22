import "server-only";

import { desc, eq, isNull } from "drizzle-orm";

import {
  filterFrameworks,
  type Framework,
  type FrameworkAvailability,
} from "@/domain/frameworks/catalog";
import { doraDemoRelease } from "@/domain/frameworks/dora-demo-release";
import { createFrameworkReleaseHash } from "@/domain/frameworks/release-content";
import type { RequirementSeed, SizeGuidance } from "@/domain/frameworks/release-schema";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { regulatoryFrameworkReleases, regulatoryFrameworks } from "@/server/db/schema/catalogue";

import { resolveCatalogueDriver } from "./driver";

export type PublishedRequirement = Omit<RequirementSeed, "sizeGuidance" | "subrequirements"> & {
  id: string;
  sizeGuidance: SizeGuidance;
  subrequirements: ReadonlyArray<
    Omit<RequirementSeed["subrequirements"][number], "sizeGuidance"> & {
      id: string;
      sizeGuidance: SizeGuidance;
    }
  >;
};

export type PublishedFrameworkRelease = Readonly<{
  id: string;
  frameworkSlug: string;
  version: string;
  contentHash: string;
  authoritativeLanguage: string;
  contentClassification: "demo" | "official_source" | "derived_mapping";
  provenanceNote: string;
  requirements: readonly PublishedRequirement[];
}>;

function matchesFrameworkQuery(framework: Framework, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("de");

  return (
    !normalizedQuery ||
    [framework.name, framework.region, ...framework.aliases].some((value) =>
      value.toLocaleLowerCase("de").includes(normalizedQuery),
    )
  );
}

async function listDatabaseFrameworks(locale: "de" | "en", query: string) {
  const records = await db.query.regulatoryFrameworks.findMany({
    where: isNull(regulatoryFrameworks.archivedAt),
    with: {
      localizations: true,
      releases: {
        where: eq(regulatoryFrameworkReleases.status, "published"),
        orderBy: [desc(regulatoryFrameworkReleases.publishedAt)],
        limit: 1,
        with: {
          requirements: {
            columns: { id: true },
          },
        },
      },
    },
  });

  return records
    .map((record): Framework => {
      const localization =
        record.localizations.find((entry) => entry.locale === locale) ??
        record.localizations.find((entry) => entry.locale === "de") ??
        record.localizations[0];

      return {
        id: record.slug,
        name: localization?.name ?? record.slug,
        region: record.region as Framework["region"],
        requirementCount: record.releases[0]?.requirements.length ?? 0,
        availability: record.availability as FrameworkAvailability,
        aliases: localization?.aliases ?? [],
      };
    })
    .filter((framework) => matchesFrameworkQuery(framework, query));
}

function mapFixtureRequirement(requirement: RequirementSeed): PublishedRequirement {
  return {
    id: `fixture:${requirement.externalKey}`,
    externalKey: requirement.externalKey,
    regulatoryId: requirement.regulatoryId,
    title: requirement.title,
    legalText: requirement.legalText,
    assessmentAspects: requirement.assessmentAspects,
    sourceLocator: requirement.sourceLocator,
    sizeGuidance: requirement.sizeGuidance,
    displayOrder: requirement.displayOrder,
    subrequirements: requirement.subrequirements.map((subrequirement) => ({
      id: `fixture:${subrequirement.externalKey}`,
      ...subrequirement,
    })),
  };
}

async function getDatabaseRelease(
  frameworkSlug: string,
): Promise<PublishedFrameworkRelease | null> {
  const framework = await db.query.regulatoryFrameworks.findFirst({
    where: eq(regulatoryFrameworks.slug, frameworkSlug),
    with: {
      releases: {
        where: eq(regulatoryFrameworkReleases.status, "published"),
        orderBy: [desc(regulatoryFrameworkReleases.publishedAt)],
        limit: 1,
        with: {
          requirements: {
            orderBy: (requirement, { asc }) => [asc(requirement.displayOrder)],
            with: {
              subrequirements: {
                orderBy: (subrequirement, { asc }) => [asc(subrequirement.displayOrder)],
              },
            },
          },
        },
      },
    },
  });
  const release = framework?.releases[0];

  if (!release || !framework || !release.contentHash) {
    return null;
  }

  return {
    id: release.id,
    frameworkSlug: framework.slug,
    version: release.version,
    contentHash: release.contentHash,
    authoritativeLanguage: release.authoritativeLanguage,
    contentClassification: release.contentClassification,
    provenanceNote: release.provenanceNote,
    requirements: release.requirements.map((requirement) => ({
      id: requirement.id,
      externalKey: requirement.externalKey,
      regulatoryId: requirement.regulatoryId,
      title: requirement.title,
      legalText: requirement.legalText,
      assessmentAspects: requirement.assessmentAspects,
      sourceLocator: requirement.sourceLocator ?? undefined,
      sizeGuidance: {
        small: requirement.smallInstitutionGuidance,
        medium: requirement.mediumInstitutionGuidance,
        large: requirement.largeInstitutionGuidance,
      },
      displayOrder: requirement.displayOrder,
      subrequirements: requirement.subrequirements.map((subrequirement) => ({
        id: subrequirement.id,
        externalKey: subrequirement.externalKey,
        regulatoryId: subrequirement.regulatoryId,
        title: subrequirement.title,
        legalText: subrequirement.legalText,
        assessmentAspects: subrequirement.assessmentAspects,
        sourceLocator: subrequirement.sourceLocator ?? undefined,
        sizeGuidance: {
          small: subrequirement.smallInstitutionGuidance,
          medium: subrequirement.mediumInstitutionGuidance,
          large: subrequirement.largeInstitutionGuidance,
        },
        displayOrder: subrequirement.displayOrder,
      })),
    })),
  };
}

export async function listFrameworkCatalogue(
  locale: "de" | "en",
  query = "",
): Promise<readonly Framework[]> {
  const driver = resolveCatalogueDriver(process.env.CATALOGUE_DRIVER, isDatabaseConfigured);

  if (driver === "fixture") {
    return filterFrameworks(query);
  }

  return listDatabaseFrameworks(locale, query);
}

export async function getSelectableFramework(
  id: string | undefined,
  locale: "de" | "en",
): Promise<Framework | undefined> {
  if (!id) return undefined;

  const frameworks = await listFrameworkCatalogue(locale);
  return frameworks.find(
    (framework) => framework.id === id && framework.availability === "included",
  );
}

export async function getPublishedFrameworkRelease(
  frameworkSlug: string,
): Promise<PublishedFrameworkRelease | null> {
  const driver = resolveCatalogueDriver(process.env.CATALOGUE_DRIVER, isDatabaseConfigured);

  if (driver === "fixture") {
    if (frameworkSlug !== doraDemoRelease.framework.slug) return null;

    return {
      id: "fixture:dora:demo-2026-08",
      frameworkSlug,
      version: doraDemoRelease.release.version,
      contentHash: createFrameworkReleaseHash(doraDemoRelease),
      authoritativeLanguage: doraDemoRelease.release.authoritativeLanguage,
      contentClassification: doraDemoRelease.release.contentClassification,
      provenanceNote: doraDemoRelease.release.provenanceNote,
      requirements: doraDemoRelease.requirements.map(mapFixtureRequirement),
    };
  }

  return getDatabaseRelease(frameworkSlug);
}
