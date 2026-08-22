import { relations, sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { analyses } from "./analyses";
import { organizations, users } from "./auth";
import {
  regulatoryFrameworkReleases,
  regulatoryRequirements,
  regulatorySubrequirements,
} from "./catalogue";
import { documentBlocks, policyVersions } from "./documents";

export const chatMessageRole = pgEnum("chat_message_role", ["user", "assistant"]);
export const chatMessageStatus = pgEnum("chat_message_status", ["completed", "failed"]);
export const chatCitationSource = pgEnum("chat_citation_source", [
  "framework_requirement",
  "framework_subrequirement",
  "policy_block",
]);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").references(() => analyses.id, { onDelete: "set null" }),
    policyVersionId: uuid("policy_version_id").references(() => policyVersions.id, {
      onDelete: "set null",
    }),
    frameworkReleaseId: uuid("framework_release_id").references(
      () => regulatoryFrameworkReleases.id,
      { onDelete: "set null" },
    ),
    title: text("title").notNull(),
    locale: text("locale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("chat_threads_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
    index("chat_threads_retention_idx").on(table.deleteAfter, table.deletedAt),
    check("chat_threads_title_check", sql`length(btrim(${table.title})) between 1 and 160`),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: chatMessageRole("role").notNull(),
    status: chatMessageStatus("status").default("completed").notNull(),
    content: text("content").notNull(),
    routeProvider: text("route_provider"),
    modelProfileId: text("model_profile_id"),
    providerModelId: text("provider_model_id"),
    modelCatalogueVersion: text("model_catalogue_version"),
    evaluationVersion: text("evaluation_version"),
    providerRequestId: text("provider_request_id"),
    inputHash: text("input_hash"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    latencyMilliseconds: integer("latency_milliseconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_thread_created_idx").on(table.threadId, table.createdAt),
    check(
      "chat_messages_model_snapshot_check",
      sql`(${table.role} = 'user' AND ${table.routeProvider} IS NULL AND ${table.providerModelId} IS NULL)
        OR (${table.role} = 'assistant' AND ${table.routeProvider} IS NOT NULL AND ${table.providerModelId} IS NOT NULL AND ${table.modelCatalogueVersion} IS NOT NULL)`,
    ),
  ],
);

export const chatCitations = pgTable(
  "chat_citations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    citationOrder: integer("citation_order").notNull(),
    sourceType: chatCitationSource("source_type").notNull(),
    requirementId: uuid("requirement_id").references(() => regulatoryRequirements.id, {
      onDelete: "set null",
    }),
    subrequirementId: uuid("subrequirement_id").references(() => regulatorySubrequirements.id, {
      onDelete: "set null",
    }),
    documentBlockId: uuid("document_block_id").references(() => documentBlocks.id, {
      onDelete: "set null",
    }),
    sourceLabel: text("source_label").notNull(),
    sourceLocator: text("source_locator"),
    exactQuote: text("exact_quote").notNull(),
    sourceHash: text("source_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("chat_citations_message_order_idx").on(table.messageId, table.citationOrder),
    check(
      "chat_citations_source_check",
      sql`(${table.sourceType} = 'framework_requirement' AND ${table.subrequirementId} IS NULL AND ${table.documentBlockId} IS NULL)
        OR (${table.sourceType} = 'framework_subrequirement' AND ${table.requirementId} IS NULL AND ${table.documentBlockId} IS NULL)
        OR (${table.sourceType} = 'policy_block' AND ${table.requirementId} IS NULL AND ${table.subrequirementId} IS NULL)`,
    ),
  ],
);

export const chatThreadRelations = relations(chatThreads, ({ many }) => ({
  messages: many(chatMessages),
}));

export const chatMessageRelations = relations(chatMessages, ({ one, many }) => ({
  thread: one(chatThreads, { fields: [chatMessages.threadId], references: [chatThreads.id] }),
  citations: many(chatCitations),
}));

export const chatCitationRelations = relations(chatCitations, ({ one }) => ({
  message: one(chatMessages, { fields: [chatCitations.messageId], references: [chatMessages.id] }),
}));
