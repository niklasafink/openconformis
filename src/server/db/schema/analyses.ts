import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
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

import { anonymousDrafts, institutionSize, sponsoredRunGrants } from "./application";
import { aiCredentials, analysisInstructions } from "./ai";
import { organizations, users } from "./auth";
import { documentBlocks, policyVersions } from "./documents";

export const analysisStatus = pgEnum("analysis_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const analysisStage = pgEnum("analysis_stage", [
  "queued",
  "preprocessing",
  "retrieval",
  "assessment",
  "verification",
  "finalizing",
  "completed",
]);

export const analysisFundingMode = pgEnum("analysis_funding_mode", ["sponsored", "byok"]);

export const analysisResultStatus = pgEnum("analysis_result_status", [
  "fulfilled",
  "partially_fulfilled",
  "not_fulfilled",
  "not_applicable",
  "no_assessment_possible",
]);

export const analysisVerificationStatus = pgEnum("analysis_verification_status", [
  "pending",
  "not_selected",
  "passed",
  "needs_review",
  "rejected",
]);

export const analysisVerificationVerdict = pgEnum("analysis_verification_verdict", [
  "confirm",
  "reject",
  "uncertain",
]);

export const evidenceSupport = pgEnum("analysis_evidence_support", [
  "supports",
  "contradicts",
  "context",
]);

export const modelInvocationStatus = pgEnum("model_invocation_status", [
  "started",
  "succeeded",
  "failed",
]);

export type AnalysisSubrequirementSnapshot = {
  externalKey: string;
  regulatoryId: string;
  title: string;
  legalText: string;
  assessmentAspects: string[];
  sourceLocator?: string;
  sizeGuidance: string;
  displayOrder: number;
};

export type CachedRequirementAssessment = {
  status:
    | "fulfilled"
    | "partially_fulfilled"
    | "not_fulfilled"
    | "not_applicable"
    | "no_assessment_possible";
  explanation: string;
  evidence: Array<{
    blockKey: string;
    exactQuote: string;
    support: "supports" | "contradicts" | "context";
  }>;
  missingInformation: string[];
  confidencePercent: number;
};

export type AnalysisRetrievalCandidateSnapshot = {
  documentBlockId: string;
  blockKey: string;
  rank: number;
  scoreBasisPoints: number;
  role: "match" | "context_before" | "context_after";
  matchedTerms: string[];
  blockTextHash: string;
};

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceDraftId: uuid("source_draft_id")
      .notNull()
      .references(() => anonymousDrafts.id, { onDelete: "restrict" }),
    policyVersionId: uuid("policy_version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "restrict" }),
    sponsoredGrantId: uuid("sponsored_grant_id").references(() => sponsoredRunGrants.id, {
      onDelete: "restrict",
    }),
    aiCredentialId: uuid("ai_credential_id").references(() => aiCredentials.id, {
      onDelete: "restrict",
    }),
    frameworkSlug: text("framework_slug").notNull(),
    frameworkReleaseKey: text("framework_release_key").notNull(),
    frameworkContentHash: text("framework_content_hash").notNull(),
    institutionSize: institutionSize("institution_size").notNull(),
    organizationContext: text("organization_context").default("").notNull(),
    locale: text("locale").notNull(),
    status: analysisStatus("status").default("queued").notNull(),
    stage: analysisStage("stage").default("queued").notNull(),
    progressPercent: integer("progress_percent").default(0).notNull(),
    fundingMode: analysisFundingMode("funding_mode").notNull(),
    routeProvider: text("route_provider").notNull(),
    providerRouteAllowlist: text("provider_route_allowlist")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    providerModelId: text("provider_model_id").notNull(),
    modelProfileId: text("model_profile_id").notNull(),
    verifierProviderModelId: text("verifier_provider_model_id").notNull(),
    verifierModelProfileId: text("verifier_model_profile_id").notNull(),
    verifierProviderRouteAllowlist: text("verifier_provider_route_allowlist")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    modelCatalogueVersion: text("model_catalogue_version").notNull(),
    privacyProfileId: text("privacy_profile_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    verifierPromptVersion: text("verifier_prompt_version").notNull(),
    assessmentInstructionId: uuid("assessment_instruction_id").references(
      () => analysisInstructions.id,
      { onDelete: "restrict" },
    ),
    assessmentInstructionHash: text("assessment_instruction_hash"),
    verificationInstructionId: uuid("verification_instruction_id").references(
      () => analysisInstructions.id,
      { onDelete: "restrict" },
    ),
    verificationInstructionHash: text("verification_instruction_hash"),
    configurationHash: text("configuration_hash").notNull(),
    policySha256: text("policy_sha256").notNull(),
    policyParserVersion: text("policy_parser_version").notNull(),
    requirementCount: integer("requirement_count").notNull(),
    unevaluatedWarningAccepted: boolean("unevaluated_warning_accepted").default(false).notNull(),
    failureCode: text("failure_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analyses_source_draft_uidx").on(table.sourceDraftId),
    index("analyses_organization_created_at_idx").on(table.organizationId, table.createdAt),
    index("analyses_status_created_at_idx").on(table.status, table.createdAt),
    index("analyses_owner_created_at_idx").on(table.ownerUserId, table.createdAt),
    uniqueIndex("analyses_ai_credential_uidx")
      .on(table.aiCredentialId)
      .where(sql`${table.aiCredentialId} IS NOT NULL`),
  ],
);

export const analysisScopeItems = pgTable(
  "analysis_scope_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    requirementExternalKey: text("requirement_external_key").notNull(),
    regulatoryId: text("regulatory_id").notNull(),
    title: text("title").notNull(),
    legalText: text("legal_text").notNull(),
    assessmentAspects: text("assessment_aspects")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    sourceLocator: text("source_locator"),
    sizeGuidance: text("size_guidance").notNull(),
    subrequirements: jsonb("subrequirements")
      .$type<AnalysisSubrequirementSnapshot[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    displayOrder: integer("display_order").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_scope_items_analysis_requirement_uidx").on(
      table.analysisId,
      table.requirementExternalKey,
    ),
    uniqueIndex("analysis_scope_items_analysis_order_uidx").on(
      table.analysisId,
      table.displayOrder,
    ),
    index("analysis_scope_items_analysis_idx").on(table.analysisId),
  ],
);

export const analysisRetrievalPackets = pgTable(
  "analysis_retrieval_packets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    scopeItemId: uuid("scope_item_id")
      .notNull()
      .references(() => analysisScopeItems.id, { onDelete: "cascade" }),
    retrievalVersion: text("retrieval_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    tokenCount: integer("token_count").notNull(),
    candidates: jsonb("candidates")
      .$type<AnalysisRetrievalCandidateSnapshot[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_retrieval_packets_scope_item_uidx").on(table.scopeItemId),
    index("analysis_retrieval_packets_analysis_idx").on(table.analysisId),
    index("analysis_retrieval_packets_output_hash_idx").on(table.outputHash),
  ],
);

export const analysisRequirementResults = pgTable(
  "analysis_requirement_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    scopeItemId: uuid("scope_item_id")
      .notNull()
      .references(() => analysisScopeItems.id, { onDelete: "cascade" }),
    status: analysisResultStatus("status").notNull(),
    explanation: text("explanation").notNull(),
    missingInformation: text("missing_information")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    confidenceBasisPoints: integer("confidence_basis_points").notNull(),
    verificationStatus: analysisVerificationStatus("verification_status")
      .default("pending")
      .notNull(),
    verifierExplanation: text("verifier_explanation"),
    assessmentModelId: text("assessment_model_id").notNull(),
    verifierModelId: text("verifier_model_id"),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    confirmedByUserId: text("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_requirement_results_scope_item_uidx").on(table.scopeItemId),
    index("analysis_requirement_results_analysis_status_idx").on(table.analysisId, table.status),
    index("analysis_requirement_results_verification_idx").on(
      table.analysisId,
      table.verificationStatus,
    ),
  ],
);

export const analysisResultOverrides = pgTable(
  "analysis_result_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => analysisRequirementResults.id, { onDelete: "cascade" }),
    status: analysisResultStatus("status").notNull(),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analysis_result_overrides_result_created_idx").on(table.resultId, table.createdAt),
    check(
      "analysis_result_overrides_reason_length_check",
      sql`length(btrim(${table.reason})) between 8 and 2000`,
    ),
  ],
);

export const analysisRequirementVerifications = pgTable(
  "analysis_requirement_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => analysisRequirementResults.id, { onDelete: "cascade" }),
    selectionReasons: text("selection_reasons")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    proposedStatus: analysisResultStatus("proposed_status").notNull(),
    proposedExplanation: text("proposed_explanation").notNull(),
    proposedConfidenceBasisPoints: integer("proposed_confidence_basis_points").notNull(),
    verdict: analysisVerificationVerdict("verdict").notNull(),
    explanation: text("explanation").notNull(),
    unsupportedClaims: text("unsupported_claims")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    missingMandatoryAspects: text("missing_mandatory_aspects")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    verifierModelId: text("verifier_model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("analysis_requirement_verifications_result_uidx").on(table.resultId)],
);

export const analysisEvidence = pgTable(
  "analysis_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => analysisRequirementResults.id, { onDelete: "cascade" }),
    documentBlockId: uuid("document_block_id")
      .notNull()
      .references(() => documentBlocks.id, { onDelete: "restrict" }),
    citationOrder: integer("citation_order").notNull(),
    support: evidenceSupport("support").notNull(),
    exactQuote: text("exact_quote").notNull(),
    blockTextHash: text("block_text_hash").notNull(),
    pageNumber: integer("page_number"),
    paragraphNumber: integer("paragraph_number"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_evidence_result_order_uidx").on(table.resultId, table.citationOrder),
    index("analysis_evidence_result_idx").on(table.resultId),
    index("analysis_evidence_block_idx").on(table.documentBlockId),
  ],
);

export const analysisAssessmentCache = pgTable(
  "analysis_assessment_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cacheKey: text("cache_key").notNull(),
    inputHash: text("input_hash").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    retrievalVersion: text("retrieval_version").notNull(),
    privacyProfileId: text("privacy_profile_id").notNull(),
    output: jsonb("output").$type<CachedRequirementAssessment>().notNull(),
    outputHash: text("output_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_assessment_cache_org_key_uidx").on(table.organizationId, table.cacheKey),
    index("analysis_assessment_cache_expiry_idx").on(table.expiresAt),
    check(
      "analysis_assessment_cache_hash_check",
      sql`${table.cacheKey} ~ '^[0-9a-f]{64}$'
        AND ${table.inputHash} ~ '^[0-9a-f]{64}$'
        AND ${table.outputHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const analysisModelInvocations = pgTable(
  "analysis_model_invocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    scopeItemId: uuid("scope_item_id").references(() => analysisScopeItems.id, {
      onDelete: "cascade",
    }),
    invocationStage: text("invocation_stage").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    providerRequestId: text("provider_request_id"),
    status: modelInvocationStatus("status").default("started").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    cacheKey: text("cache_key"),
    cacheHit: boolean("cache_hit").default(false).notNull(),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    costMicrounits: integer("cost_microunits"),
    latencyMilliseconds: integer("latency_milliseconds"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("analysis_model_invocations_analysis_started_idx").on(table.analysisId, table.startedAt),
    index("analysis_model_invocations_cache_idx").on(table.cacheKey, table.cacheHit),
  ],
);

export const analysisRelations = relations(analyses, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [analyses.organizationId],
    references: [organizations.id],
  }),
  owner: one(users, { fields: [analyses.ownerUserId], references: [users.id] }),
  sourceDraft: one(anonymousDrafts, {
    fields: [analyses.sourceDraftId],
    references: [anonymousDrafts.id],
  }),
  policyVersion: one(policyVersions, {
    fields: [analyses.policyVersionId],
    references: [policyVersions.id],
  }),
  sponsoredGrant: one(sponsoredRunGrants, {
    fields: [analyses.sponsoredGrantId],
    references: [sponsoredRunGrants.id],
  }),
  scopeItems: many(analysisScopeItems),
  retrievalPackets: many(analysisRetrievalPackets),
  results: many(analysisRequirementResults),
  modelInvocations: many(analysisModelInvocations),
}));

export const analysisScopeItemRelations = relations(analysisScopeItems, ({ one }) => ({
  analysis: one(analyses, {
    fields: [analysisScopeItems.analysisId],
    references: [analyses.id],
  }),
}));

export const analysisRetrievalPacketRelations = relations(analysisRetrievalPackets, ({ one }) => ({
  analysis: one(analyses, {
    fields: [analysisRetrievalPackets.analysisId],
    references: [analyses.id],
  }),
  scopeItem: one(analysisScopeItems, {
    fields: [analysisRetrievalPackets.scopeItemId],
    references: [analysisScopeItems.id],
  }),
}));

export const analysisRequirementResultRelations = relations(
  analysisRequirementResults,
  ({ one, many }) => ({
    analysis: one(analyses, {
      fields: [analysisRequirementResults.analysisId],
      references: [analyses.id],
    }),
    scopeItem: one(analysisScopeItems, {
      fields: [analysisRequirementResults.scopeItemId],
      references: [analysisScopeItems.id],
    }),
    evidence: many(analysisEvidence),
    overrides: many(analysisResultOverrides),
    verification: one(analysisRequirementVerifications),
  }),
);

export const analysisResultOverrideRelations = relations(analysisResultOverrides, ({ one }) => ({
  result: one(analysisRequirementResults, {
    fields: [analysisResultOverrides.resultId],
    references: [analysisRequirementResults.id],
  }),
  actor: one(users, {
    fields: [analysisResultOverrides.actorUserId],
    references: [users.id],
  }),
}));

export const analysisRequirementVerificationRelations = relations(
  analysisRequirementVerifications,
  ({ one }) => ({
    result: one(analysisRequirementResults, {
      fields: [analysisRequirementVerifications.resultId],
      references: [analysisRequirementResults.id],
    }),
  }),
);

export const analysisEvidenceRelations = relations(analysisEvidence, ({ one }) => ({
  result: one(analysisRequirementResults, {
    fields: [analysisEvidence.resultId],
    references: [analysisRequirementResults.id],
  }),
  documentBlock: one(documentBlocks, {
    fields: [analysisEvidence.documentBlockId],
    references: [documentBlocks.id],
  }),
}));

export const analysisModelInvocationRelations = relations(analysisModelInvocations, ({ one }) => ({
  analysis: one(analyses, {
    fields: [analysisModelInvocations.analysisId],
    references: [analyses.id],
  }),
  scopeItem: one(analysisScopeItems, {
    fields: [analysisModelInvocations.scopeItemId],
    references: [analysisScopeItems.id],
  }),
}));
