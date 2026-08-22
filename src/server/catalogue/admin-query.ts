import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  regulatoryFrameworkLocalizations,
  regulatoryFrameworkReleases,
  regulatoryFrameworks,
  regulatoryRequirements,
  regulatorySubrequirements,
} from "@/server/db/schema/catalogue";

import { requireCatalogueAdministrator } from "./administrator";

export async function listAdminCatalogue() {
  await requireCatalogueAdministrator();
  const [frameworkRows, releases, requirements, subrequirements] = await Promise.all([
    db
      .select({ framework: regulatoryFrameworks, localization: regulatoryFrameworkLocalizations })
      .from(regulatoryFrameworks)
      .leftJoin(
        regulatoryFrameworkLocalizations,
        eq(regulatoryFrameworkLocalizations.frameworkId, regulatoryFrameworks.id),
      )
      .orderBy(asc(regulatoryFrameworks.slug), asc(regulatoryFrameworkLocalizations.locale)),
    db
      .select()
      .from(regulatoryFrameworkReleases)
      .orderBy(asc(regulatoryFrameworkReleases.createdAt)),
    db.select().from(regulatoryRequirements).orderBy(asc(regulatoryRequirements.displayOrder)),
    db
      .select()
      .from(regulatorySubrequirements)
      .orderBy(asc(regulatorySubrequirements.displayOrder)),
  ]);

  const localizations = new Map<string, Record<string, string>>();
  for (const row of frameworkRows) {
    if (!row.localization) continue;
    const value = localizations.get(row.framework.id) ?? {};
    value[row.localization.locale] = row.localization.name;
    localizations.set(row.framework.id, value);
  }
  const uniqueFrameworks = [
    ...new Map(frameworkRows.map((row) => [row.framework.id, row.framework])).values(),
  ];

  return uniqueFrameworks.map((framework) => ({
    ...framework,
    names: localizations.get(framework.id) ?? {},
    releases: releases
      .filter((release) => release.frameworkId === framework.id)
      .map((release) => ({
        ...release,
        requirements: requirements
          .filter((requirement) => requirement.releaseId === release.id)
          .map((requirement) => ({
            ...requirement,
            subrequirements: subrequirements.filter(
              (subrequirement) => subrequirement.parentRequirementId === requirement.id,
            ),
          })),
      })),
  }));
}
