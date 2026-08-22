import { createContentHash } from "./content-hash";
import type { FrameworkReleaseSeed, RequirementSeed, SubrequirementSeed } from "./release-schema";

function catalogueItemMaterial(item: RequirementSeed | SubrequirementSeed) {
  return {
    externalKey: item.externalKey,
    regulatoryId: item.regulatoryId,
    title: item.title,
    legalText: item.legalText,
    assessmentAspects: item.assessmentAspects,
    sourceLocator: item.sourceLocator,
    sizeGuidance: item.sizeGuidance,
    displayOrder: item.displayOrder,
  };
}

export function createCatalogueItemHash(item: RequirementSeed | SubrequirementSeed): string {
  return createContentHash(catalogueItemMaterial(item));
}

export function createFrameworkReleaseHash(seed: FrameworkReleaseSeed): string {
  return createContentHash({
    frameworkSlug: seed.framework.slug,
    release: seed.release,
    requirements: seed.requirements.map((requirement) => ({
      ...catalogueItemMaterial(requirement),
      subrequirements: requirement.subrequirements.map(catalogueItemMaterial),
    })),
  });
}
