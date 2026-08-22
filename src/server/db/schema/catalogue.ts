import { relations, sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

export const frameworkAvailability = pgEnum("framework_availability", ["included", "locked"]);

export const frameworkReleaseStatus = pgEnum("framework_release_status", [
  "draft",
  "published",
  "archived",
]);

export const frameworkContentClassification = pgEnum("framework_content_classification", [
  "demo",
  "official_source",
  "derived_mapping",
]);

export const catalogueAdministrators = pgTable(
  "catalogue_administrators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("catalogue_administrators_user_id_uidx").on(table.userId)],
);

export const regulatoryFrameworks = pgTable(
  "regulatory_frameworks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    region: text("region").notNull(),
    availability: frameworkAvailability("availability").default("locked").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("regulatory_frameworks_slug_uidx").on(table.slug),
    index("regulatory_frameworks_availability_idx").on(table.availability, table.archivedAt),
  ],
);

export const regulatoryFrameworkLocalizations = pgTable(
  "regulatory_framework_localizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    frameworkId: uuid("framework_id")
      .notNull()
      .references(() => regulatoryFrameworks.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    name: text("name").notNull(),
    aliases: jsonb("aliases")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("regulatory_framework_localizations_framework_locale_uidx").on(
      table.frameworkId,
      table.locale,
    ),
  ],
);

export const regulatoryFrameworkReleases = pgTable(
  "regulatory_framework_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    frameworkId: uuid("framework_id")
      .notNull()
      .references(() => regulatoryFrameworks.id, { onDelete: "restrict" }),
    version: text("version").notNull(),
    status: frameworkReleaseStatus("status").default("draft").notNull(),
    authoritativeLanguage: text("authoritative_language").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveUntil: date("effective_until"),
    sourceTitle: text("source_title").notNull(),
    sourceUrl: text("source_url"),
    sourceLocator: text("source_locator"),
    sourceRetrievedAt: timestamp("source_retrieved_at", { withTimezone: true }),
    contentClassification: frameworkContentClassification("content_classification")
      .default("demo")
      .notNull(),
    provenanceNote: text("provenance_note").notNull(),
    reuseNotice: text("reuse_notice").notNull(),
    contentHash: text("content_hash"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByUserId: text("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("regulatory_framework_releases_framework_version_uidx").on(
      table.frameworkId,
      table.version,
    ),
    index("regulatory_framework_releases_lookup_idx").on(
      table.frameworkId,
      table.status,
      table.publishedAt,
    ),
  ],
);

export const regulatoryRequirements = pgTable(
  "regulatory_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => regulatoryFrameworkReleases.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    regulatoryId: text("regulatory_id").notNull(),
    title: text("title").notNull(),
    legalText: text("legal_text").notNull(),
    assessmentAspects: text("assessment_aspects").array().notNull(),
    sourceLocator: text("source_locator"),
    smallInstitutionGuidance: text("small_institution_guidance").notNull(),
    mediumInstitutionGuidance: text("medium_institution_guidance").notNull(),
    largeInstitutionGuidance: text("large_institution_guidance").notNull(),
    displayOrder: integer("display_order").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("regulatory_requirements_release_key_uidx").on(table.releaseId, table.externalKey),
    uniqueIndex("regulatory_requirements_release_order_uidx").on(
      table.releaseId,
      table.displayOrder,
    ),
    index("regulatory_requirements_release_idx").on(table.releaseId),
  ],
);

export const regulatorySubrequirements = pgTable(
  "regulatory_subrequirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    releaseId: uuid("release_id")
      .notNull()
      .references(() => regulatoryFrameworkReleases.id, { onDelete: "cascade" }),
    parentRequirementId: uuid("parent_requirement_id")
      .notNull()
      .references(() => regulatoryRequirements.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    regulatoryId: text("regulatory_id").notNull(),
    title: text("title").notNull(),
    legalText: text("legal_text").notNull(),
    assessmentAspects: text("assessment_aspects").array().notNull(),
    sourceLocator: text("source_locator"),
    smallInstitutionGuidance: text("small_institution_guidance").notNull(),
    mediumInstitutionGuidance: text("medium_institution_guidance").notNull(),
    largeInstitutionGuidance: text("large_institution_guidance").notNull(),
    displayOrder: integer("display_order").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("regulatory_subrequirements_parent_key_uidx").on(
      table.parentRequirementId,
      table.externalKey,
    ),
    uniqueIndex("regulatory_subrequirements_parent_order_uidx").on(
      table.parentRequirementId,
      table.displayOrder,
    ),
    index("regulatory_subrequirements_release_idx").on(table.releaseId),
  ],
);

export const regulatoryFrameworkRelations = relations(regulatoryFrameworks, ({ many }) => ({
  localizations: many(regulatoryFrameworkLocalizations),
  releases: many(regulatoryFrameworkReleases),
}));

export const catalogueAdministratorRelations = relations(catalogueAdministrators, ({ one }) => ({
  user: one(users, {
    fields: [catalogueAdministrators.userId],
    references: [users.id],
    relationName: "catalogueAdministratorUser",
  }),
  grantedBy: one(users, {
    fields: [catalogueAdministrators.grantedByUserId],
    references: [users.id],
    relationName: "catalogueAdministratorGrantor",
  }),
}));

export const regulatoryFrameworkLocalizationRelations = relations(
  regulatoryFrameworkLocalizations,
  ({ one }) => ({
    framework: one(regulatoryFrameworks, {
      fields: [regulatoryFrameworkLocalizations.frameworkId],
      references: [regulatoryFrameworks.id],
    }),
  }),
);

export const regulatoryFrameworkReleaseRelations = relations(
  regulatoryFrameworkReleases,
  ({ one, many }) => ({
    framework: one(regulatoryFrameworks, {
      fields: [regulatoryFrameworkReleases.frameworkId],
      references: [regulatoryFrameworks.id],
    }),
    publishedBy: one(users, {
      fields: [regulatoryFrameworkReleases.publishedByUserId],
      references: [users.id],
    }),
    requirements: many(regulatoryRequirements),
    subrequirements: many(regulatorySubrequirements),
  }),
);

export const regulatoryRequirementRelations = relations(
  regulatoryRequirements,
  ({ one, many }) => ({
    release: one(regulatoryFrameworkReleases, {
      fields: [regulatoryRequirements.releaseId],
      references: [regulatoryFrameworkReleases.id],
    }),
    subrequirements: many(regulatorySubrequirements),
  }),
);

export const regulatorySubrequirementRelations = relations(
  regulatorySubrequirements,
  ({ one }) => ({
    release: one(regulatoryFrameworkReleases, {
      fields: [regulatorySubrequirements.releaseId],
      references: [regulatoryFrameworkReleases.id],
    }),
    parentRequirement: one(regulatoryRequirements, {
      fields: [regulatorySubrequirements.parentRequirementId],
      references: [regulatoryRequirements.id],
    }),
  }),
);
