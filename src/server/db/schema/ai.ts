import { sql } from "drizzle-orm";
import {
  check,
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

import { anonymousDrafts } from "./application";
import { organizations, users } from "./auth";

export const aiRouteProvider = pgEnum("ai_route_provider", [
  "openrouter",
  "requesty",
  "anthropic",
  "google",
  "openai",
]);

export const aiCredentialPurpose = pgEnum("ai_credential_purpose", ["analysis", "chat"]);

export const aiCredentialStatus = pgEnum("ai_credential_status", [
  "active",
  "revoked",
  "expired",
  "deleted",
]);

export const aiModelLifecycle = pgEnum("ai_model_lifecycle", [
  "unevaluated",
  "candidate",
  "certified",
  "deprecated",
  "blocked",
]);

export const aiModelRecommendation = pgEnum("ai_model_recommendation", [
  "quality",
  "balanced",
  "economy",
]);

export const aiEvaluationStatus = pgEnum("ai_evaluation_status", ["draft", "published"]);

export const analysisInstructionKind = pgEnum("analysis_instruction_kind", [
  "assessment",
  "verification",
]);

export const analysisInstructionStatus = pgEnum("analysis_instruction_status", [
  "draft",
  "published",
  "archived",
]);

export const analysisInstructions = pgTable(
  "analysis_instructions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: analysisInstructionKind("kind").notNull(),
    version: text("version").notNull(),
    status: analysisInstructionStatus("status").default("draft").notNull(),
    instruction: text("instruction").notNull(),
    contentHash: text("content_hash").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByUserId: text("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_instructions_kind_version_uidx").on(table.kind, table.version),
    uniqueIndex("analysis_instructions_one_published_kind_uidx")
      .on(table.kind)
      .where(sql`${table.status} = 'published'`),
    index("analysis_instructions_status_idx").on(table.status, table.kind, table.publishedAt),
    check(
      "analysis_instructions_content_check",
      sql`length(btrim(${table.version})) between 1 and 100
        AND length(btrim(${table.instruction})) between 40 and 20000
        AND ${table.contentHash} ~ '^[0-9a-f]{64}$'
        AND (
          (${table.status} = 'draft' AND ${table.publishedAt} IS NULL)
          OR (${table.status} IN ('published', 'archived') AND ${table.publishedAt} IS NOT NULL)
        )`,
    ),
  ],
);

export const aiModelProfiles = pgTable(
  "ai_model_profiles",
  {
    id: text("id").primaryKey(),
    publisher: text("publisher").notNull(),
    displayName: text("display_name").notNull(),
    routeProvider: aiRouteProvider("route_provider").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    tasks: text("tasks").array().notNull(),
    lifecycle: aiModelLifecycle("lifecycle").default("unevaluated").notNull(),
    recommendation: aiModelRecommendation("recommendation"),
    supportsStructuredOutput: boolean("supports_structured_output").default(false).notNull(),
    supportsStreaming: boolean("supports_streaming").default(false).notNull(),
    contextWindow: integer("context_window"),
    privacyProfileId: text("privacy_profile_id").notNull(),
    evaluationVersion: text("evaluation_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_model_profiles_route_model_uidx").on(
      table.routeProvider,
      table.providerModelId,
    ),
    index("ai_model_profiles_lifecycle_idx").on(table.lifecycle, table.recommendation),
    check(
      "ai_model_profiles_certification_check",
      sql`(${table.lifecycle} <> 'certified' OR ${table.evaluationVersion} IS NOT NULL)
        AND (${table.recommendation} IS NULL OR ${table.lifecycle} = 'certified')
        AND cardinality(${table.tasks}) > 0`,
    ),
  ],
);

export const aiModelEvaluations = pgTable(
  "ai_model_evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    modelProfileId: text("model_profile_id")
      .notNull()
      .references(() => aiModelProfiles.id, { onDelete: "restrict" }),
    evaluationVersion: text("evaluation_version").notNull(),
    datasetHash: text("dataset_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    repeatCount: integer("repeat_count").notNull(),
    fabricatedEvidenceCount: integer("fabricated_evidence_count").notNull(),
    evidenceValidityBasisPoints: integer("evidence_validity_basis_points").notNull(),
    falsePositiveFulfilledBasisPoints: integer("false_positive_fulfilled_basis_points").notNull(),
    evidencePrecisionBasisPoints: integer("evidence_precision_basis_points").notNull(),
    evidenceRecallBasisPoints: integer("evidence_recall_basis_points").notNull(),
    macroF1BasisPoints: integer("macro_f1_basis_points").notNull(),
    schemaReliabilityBasisPoints: integer("schema_reliability_basis_points").notNull(),
    germanRegulatoryBasisPoints: integer("german_regulatory_basis_points").notNull(),
    p95LatencyMilliseconds: integer("p95_latency_milliseconds").notNull(),
    costMicrounitsPerRun: integer("cost_microunits_per_run").notNull(),
    privacyQualified: boolean("privacy_qualified").notNull(),
    mandatoryThresholdsPassed: boolean("mandatory_thresholds_passed").notNull(),
    status: aiEvaluationStatus("status").default("draft").notNull(),
    metrics: jsonb("metrics")
      .$type<Record<string, number | boolean>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedByUserId: text("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_model_evaluations_profile_version_uidx").on(
      table.modelProfileId,
      table.evaluationVersion,
    ),
    index("ai_model_evaluations_status_idx").on(table.status, table.publishedAt),
    check(
      "ai_model_evaluations_threshold_check",
      sql`${table.repeatCount} > 0
        AND ${table.fabricatedEvidenceCount} >= 0
        AND ${table.evidenceValidityBasisPoints} BETWEEN 0 AND 10000
        AND ${table.falsePositiveFulfilledBasisPoints} BETWEEN 0 AND 10000
        AND ${table.evidencePrecisionBasisPoints} BETWEEN 0 AND 10000
        AND ${table.evidenceRecallBasisPoints} BETWEEN 0 AND 10000
        AND ${table.macroF1BasisPoints} BETWEEN 0 AND 10000
        AND ${table.schemaReliabilityBasisPoints} BETWEEN 0 AND 10000
        AND ${table.germanRegulatoryBasisPoints} BETWEEN 0 AND 10000
        AND (${table.status} <> 'published' OR (${table.publishedAt} IS NOT NULL AND ${table.publishedByUserId} IS NOT NULL))`,
    ),
  ],
);

export const draftModelSelections = pgTable(
  "draft_model_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    anonymousDraftId: uuid("anonymous_draft_id")
      .notNull()
      .references(() => anonymousDrafts.id, { onDelete: "cascade" }),
    routeProvider: aiRouteProvider("route_provider").notNull(),
    modelProfileId: text("model_profile_id").notNull(),
    providerModelId: text("provider_model_id").notNull(),
    modelCatalogueVersion: text("model_catalogue_version").notNull(),
    evaluated: boolean("evaluated").default(false).notNull(),
    unevaluatedWarningAccepted: boolean("unevaluated_warning_accepted").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("draft_model_selections_draft_uidx").on(table.anonymousDraftId),
    check(
      "draft_model_selections_content_check",
      sql`length(btrim(${table.modelProfileId})) > 0
        AND length(btrim(${table.providerModelId})) > 0
        AND ${table.modelCatalogueVersion} ~ '^[0-9a-f]{64}$'
        AND (${table.evaluated} OR ${table.unevaluatedWarningAccepted})`,
    ),
  ],
);

export const aiCredentials = pgTable(
  "ai_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    sessionId: text("session_id").notNull(),
    provider: aiRouteProvider("provider").notNull(),
    purpose: aiCredentialPurpose("purpose").notNull(),
    bindingId: text("binding_id").notNull(),
    status: aiCredentialStatus("status").default("active").notNull(),
    encryptedSecret: text("encrypted_secret"),
    nonce: text("nonce"),
    authenticationTag: text("authentication_tag"),
    encryptionKeyVersion: integer("encryption_key_version").notNull(),
    secretLastFour: text("secret_last_four").notNull(),
    safeLabel: text("safe_label"),
    privacyAttestationAccepted: boolean("privacy_attestation_accepted").default(false).notNull(),
    accessibleModelIds: text("accessible_model_ids")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    modelAccessHash: text("model_access_hash").notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_credentials_owner_status_idx").on(table.ownerUserId, table.status, table.expiresAt),
    index("ai_credentials_expiry_idx").on(table.status, table.expiresAt),
    index("ai_credentials_binding_idx").on(table.ownerUserId, table.purpose, table.bindingId),
    uniqueIndex("ai_credentials_active_binding_uidx")
      .on(table.ownerUserId, table.sessionId, table.provider, table.purpose, table.bindingId)
      .where(sql`${table.status} = 'active'`),
    check(
      "ai_credentials_identity_check",
      sql`length(btrim(${table.sessionId})) > 0
        AND length(btrim(${table.bindingId})) > 0
        AND ${table.encryptionKeyVersion} > 0
        AND length(${table.secretLastFour}) = 4
        AND (${table.safeLabel} IS NULL OR length(${table.safeLabel}) <= 200)
        AND (${table.purpose} <> 'analysis'
          OR ${table.provider} NOT IN ('requesty', 'openai')
          OR ${table.privacyAttestationAccepted})
        AND cardinality(${table.accessibleModelIds}) = 1
        AND length(btrim(${table.accessibleModelIds}[1])) > 0
        AND ${table.modelAccessHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_credentials_ttl_check",
      sql`${table.expiresAt} > ${table.validatedAt}
        AND ${table.expiresAt} <= ${table.validatedAt} + interval '24 hours'`,
    ),
    check(
      "ai_credentials_secret_state_check",
      sql`(
          ${table.status} = 'active'
          AND ${table.encryptedSecret} IS NOT NULL
          AND ${table.nonce} IS NOT NULL
          AND ${table.authenticationTag} IS NOT NULL
          AND ${table.revokedAt} IS NULL
          AND ${table.deletedAt} IS NULL
        ) OR (
          ${table.status} <> 'active'
          AND ${table.encryptedSecret} IS NULL
          AND ${table.nonce} IS NULL
          AND ${table.authenticationTag} IS NULL
          AND (${table.status} <> 'revoked' OR ${table.revokedAt} IS NOT NULL)
          AND (${table.status} NOT IN ('expired', 'deleted') OR ${table.deletedAt} IS NOT NULL)
        )`,
    ),
  ],
);
