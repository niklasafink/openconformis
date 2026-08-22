import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { anonymousDrafts } from "./application";
import { organizations, users } from "./auth";

export const policyLifecycleStatus = pgEnum("policy_lifecycle_status", [
  "active",
  "deleting",
  "deleted",
]);

export const policyVersionSource = pgEnum("policy_version_source", ["sample", "upload"]);

export const policyParseStatus = pgEnum("policy_parse_status", [
  "awaiting_upload",
  "uploaded",
  "validating",
  "quarantined",
  "parsing",
  "needs_ocr",
  "ocr_processing",
  "needs_ocr_review",
  "ready",
  "failed",
  "deleting",
  "deleted",
]);

export const documentBlockType = pgEnum("document_block_type", [
  "title",
  "heading",
  "paragraph",
  "list_item",
  "table_cell",
]);

export const policyUploadIntentStatus = pgEnum("policy_upload_intent_status", [
  "issued",
  "uploaded",
  "expired",
  "revoked",
]);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    anonymousDraftId: uuid("anonymous_draft_id").references(() => anonymousDrafts.id, {
      onDelete: "restrict",
    }),
    displayName: text("display_name").notNull(),
    lifecycleStatus: policyLifecycleStatus("lifecycle_status").default("active").notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("policies_organization_created_at_idx").on(table.organizationId, table.createdAt),
    index("policies_anonymous_draft_idx").on(table.anonymousDraftId),
  ],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "restrict" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    anonymousDraftId: uuid("anonymous_draft_id").references(() => anonymousDrafts.id, {
      onDelete: "restrict",
    }),
    versionNumber: integer("version_number").notNull(),
    source: policyVersionSource("source").notNull(),
    originalFilename: text("original_filename").notNull(),
    detectedMimeType: text("detected_mime_type"),
    declaredMimeType: text("declared_mime_type"),
    byteSize: integer("byte_size"),
    sha256: text("sha256"),
    storageDriver: text("storage_driver").notNull(),
    objectKey: text("object_key").notNull(),
    objectEtag: text("object_etag"),
    ingestionWorkflowRunId: text("ingestion_workflow_run_id"),
    processedObjectKey: text("processed_object_key"),
    processedSha256: text("processed_sha256"),
    ocrEngineVersion: text("ocr_engine_version"),
    parserVersion: text("parser_version"),
    parseStatus: policyParseStatus("parse_status").default("awaiting_upload").notNull(),
    parseErrorCode: text("parse_error_code"),
    pageCount: integer("page_count"),
    authoritativeLanguage: text("authoritative_language"),
    provenanceNote: text("provenance_note"),
    reuseNotice: text("reuse_notice"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    ocrCompletedAt: timestamp("ocr_completed_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    originalDeleteAfter: timestamp("original_delete_after", { withTimezone: true }).notNull(),
    parsedDeleteAfter: timestamp("parsed_delete_after", { withTimezone: true }).notNull(),
    originalDeletedAt: timestamp("original_deleted_at", { withTimezone: true }),
    parsedDeletedAt: timestamp("parsed_deleted_at", { withTimezone: true }),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("policy_versions_policy_version_uidx").on(table.policyId, table.versionNumber),
    uniqueIndex("policy_versions_object_key_uidx").on(table.objectKey),
    uniqueIndex("policy_versions_processed_object_key_uidx")
      .on(table.processedObjectKey)
      .where(sql`${table.processedObjectKey} is not null`),
    uniqueIndex("policy_versions_ingestion_workflow_run_uidx")
      .on(table.ingestionWorkflowRunId)
      .where(sql`${table.ingestionWorkflowRunId} is not null`),
    uniqueIndex("policy_versions_org_hash_parser_uidx")
      .on(table.organizationId, table.sha256, table.parserVersion)
      .where(
        sql`${table.organizationId} is not null and ${table.sha256} is not null and ${table.parserVersion} is not null`,
      ),
    index("policy_versions_parse_status_idx").on(table.parseStatus, table.createdAt),
    index("policy_versions_original_cleanup_idx").on(table.originalDeleteAfter, table.parseStatus),
    index("policy_versions_parsed_cleanup_idx").on(table.parsedDeleteAfter, table.parseStatus),
  ],
);

export const documentBlocks = pgTable(
  "document_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    blockKey: text("block_key").notNull(),
    ordinal: integer("ordinal").notNull(),
    blockType: documentBlockType("block_type").notNull(),
    canonicalText: text("canonical_text").notNull(),
    pageNumber: integer("page_number"),
    paragraphNumber: integer("paragraph_number"),
    headingPath: text("heading_path")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    tokenCount: integer("token_count"),
    textHash: text("text_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("document_blocks_version_key_uidx").on(table.policyVersionId, table.blockKey),
    uniqueIndex("document_blocks_version_ordinal_uidx").on(table.policyVersionId, table.ordinal),
    index("document_blocks_policy_version_idx").on(table.policyVersionId),
  ],
);

export const draftPolicySelections = pgTable(
  "draft_policy_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    anonymousDraftId: uuid("anonymous_draft_id")
      .notNull()
      .references(() => anonymousDrafts.id, { onDelete: "cascade" }),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("draft_policy_selections_draft_uidx").on(table.anonymousDraftId),
    index("draft_policy_selections_version_idx").on(table.policyVersionId),
  ],
);

export const policyUploadIntents = pgTable(
  "policy_upload_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    anonymousDraftId: uuid("anonymous_draft_id")
      .notNull()
      .references(() => anonymousDrafts.id, { onDelete: "cascade" }),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    status: policyUploadIntentStatus("status").default("issued").notNull(),
    objectKey: text("object_key").notNull(),
    declaredFilename: text("declared_filename").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    declaredByteSize: integer("declared_byte_size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("policy_upload_intents_object_key_uidx").on(table.objectKey),
    index("policy_upload_intents_draft_status_idx").on(
      table.anonymousDraftId,
      table.status,
      table.expiresAt,
    ),
  ],
);

export const policyRelations = relations(policies, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [policies.organizationId],
    references: [organizations.id],
  }),
  anonymousDraft: one(anonymousDrafts, {
    fields: [policies.anonymousDraftId],
    references: [anonymousDrafts.id],
  }),
  owner: one(users, { fields: [policies.ownerUserId], references: [users.id] }),
  versions: many(policyVersions),
}));

export const policyVersionRelations = relations(policyVersions, ({ one, many }) => ({
  policy: one(policies, { fields: [policyVersions.policyId], references: [policies.id] }),
  blocks: many(documentBlocks),
  draftSelections: many(draftPolicySelections),
  uploadIntents: many(policyUploadIntents),
}));

export const documentBlockRelations = relations(documentBlocks, ({ one }) => ({
  policyVersion: one(policyVersions, {
    fields: [documentBlocks.policyVersionId],
    references: [policyVersions.id],
  }),
}));

export const draftPolicySelectionRelations = relations(draftPolicySelections, ({ one }) => ({
  anonymousDraft: one(anonymousDrafts, {
    fields: [draftPolicySelections.anonymousDraftId],
    references: [anonymousDrafts.id],
  }),
  policyVersion: one(policyVersions, {
    fields: [draftPolicySelections.policyVersionId],
    references: [policyVersions.id],
  }),
}));

export const policyUploadIntentRelations = relations(policyUploadIntents, ({ one }) => ({
  anonymousDraft: one(anonymousDrafts, {
    fields: [policyUploadIntents.anonymousDraftId],
    references: [anonymousDrafts.id],
  }),
  policyVersion: one(policyVersions, {
    fields: [policyUploadIntents.policyVersionId],
    references: [policyVersions.id],
  }),
}));
