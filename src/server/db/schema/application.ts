import { relations, sql } from "drizzle-orm";
import {
  boolean,
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

import { organizations, users } from "./auth";

export const anonymousDraftStatus = pgEnum("anonymous_draft_status", [
  "active",
  "claimed",
  "expired",
  "revoked",
]);

export const grantStatus = pgEnum("sponsored_grant_status", [
  "available",
  "reserved",
  "consumed",
  "blocked",
]);

export const institutionSize = pgEnum("institution_size", ["small", "medium", "large"]);

export const anonymousDrafts = pgTable(
  "anonymous_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bindingHash: text("binding_hash").notNull(),
    status: anonymousDraftStatus("status").default("active").notNull(),
    frameworkSlug: text("framework_slug"),
    locale: text("locale").default("de").notNull(),
    revision: integer("revision").default(1).notNull(),
    claimedByUserId: text("claimed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("anonymous_drafts_binding_hash_uidx").on(table.bindingHash),
    index("anonymous_drafts_status_expires_at_idx").on(table.status, table.expiresAt),
  ],
);

export const sponsoredRunGrants = pgTable(
  "sponsored_run_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: grantStatus("status").default("available").notNull(),
    revision: integer("revision").default(1).notNull(),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    blockReasonCode: text("block_reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("sponsored_run_grants_user_id_uidx").on(table.userId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    anonymousDraftId: uuid("anonymous_draft_id").references(() => anonymousDrafts.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestId: text("request_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_events_organization_created_at_idx").on(table.organizationId, table.createdAt),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
  ],
);

export const draftAnalysisScopes = pgTable(
  "draft_analysis_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    anonymousDraftId: uuid("anonymous_draft_id")
      .notNull()
      .references(() => anonymousDrafts.id, { onDelete: "cascade" }),
    frameworkSlug: text("framework_slug").notNull(),
    frameworkReleaseKey: text("framework_release_key").notNull(),
    frameworkContentHash: text("framework_content_hash").notNull(),
    institutionSize: institutionSize("institution_size").notNull(),
    organizationContext: text("organization_context").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("draft_analysis_scopes_draft_uidx").on(table.anonymousDraftId),
    index("draft_analysis_scopes_release_idx").on(table.frameworkSlug, table.frameworkContentHash),
  ],
);

export const draftRequirementSelections = pgTable(
  "draft_requirement_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftScopeId: uuid("draft_scope_id")
      .notNull()
      .references(() => draftAnalysisScopes.id, { onDelete: "cascade" }),
    requirementExternalKey: text("requirement_external_key").notNull(),
    included: boolean("included").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("draft_requirement_selections_scope_requirement_uidx").on(
      table.draftScopeId,
      table.requirementExternalKey,
    ),
    index("draft_requirement_selections_scope_idx").on(table.draftScopeId),
  ],
);

export const anonymousDraftRelations = relations(anonymousDrafts, ({ one, many }) => ({
  claimedBy: one(users, {
    fields: [anonymousDrafts.claimedByUserId],
    references: [users.id],
  }),
  auditEvents: many(auditEvents),
  analysisScope: one(draftAnalysisScopes),
}));

export const draftAnalysisScopeRelations = relations(draftAnalysisScopes, ({ one, many }) => ({
  anonymousDraft: one(anonymousDrafts, {
    fields: [draftAnalysisScopes.anonymousDraftId],
    references: [anonymousDrafts.id],
  }),
  requirementSelections: many(draftRequirementSelections),
}));

export const draftRequirementSelectionRelations = relations(
  draftRequirementSelections,
  ({ one }) => ({
    scope: one(draftAnalysisScopes, {
      fields: [draftRequirementSelections.draftScopeId],
      references: [draftAnalysisScopes.id],
    }),
  }),
);

export const sponsoredRunGrantRelations = relations(sponsoredRunGrants, ({ one }) => ({
  user: one(users, {
    fields: [sponsoredRunGrants.userId],
    references: [users.id],
  }),
}));

export const auditEventRelations = relations(auditEvents, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditEvents.organizationId],
    references: [organizations.id],
  }),
  actor: one(users, {
    fields: [auditEvents.actorUserId],
    references: [users.id],
  }),
  anonymousDraft: one(anonymousDrafts, {
    fields: [auditEvents.anonymousDraftId],
    references: [anonymousDrafts.id],
  }),
}));
