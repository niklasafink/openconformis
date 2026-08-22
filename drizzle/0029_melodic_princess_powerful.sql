CREATE TYPE "public"."ai_evaluation_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."ai_model_lifecycle" AS ENUM('unevaluated', 'candidate', 'certified', 'deprecated', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."ai_model_recommendation" AS ENUM('quality', 'balanced', 'economy');--> statement-breakpoint
CREATE TYPE "public"."chat_citation_source" AS ENUM('framework_requirement', 'policy_block');--> statement-breakpoint
CREATE TYPE "public"."chat_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."chat_message_status" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TABLE "ai_model_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_profile_id" text NOT NULL,
	"evaluation_version" text NOT NULL,
	"dataset_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"repeat_count" integer NOT NULL,
	"fabricated_evidence_count" integer NOT NULL,
	"evidence_validity_basis_points" integer NOT NULL,
	"false_positive_fulfilled_basis_points" integer NOT NULL,
	"evidence_precision_basis_points" integer NOT NULL,
	"evidence_recall_basis_points" integer NOT NULL,
	"macro_f1_basis_points" integer NOT NULL,
	"schema_reliability_basis_points" integer NOT NULL,
	"german_regulatory_basis_points" integer NOT NULL,
	"p95_latency_milliseconds" integer NOT NULL,
	"cost_microunits_per_run" integer NOT NULL,
	"privacy_qualified" boolean NOT NULL,
	"mandatory_thresholds_passed" boolean NOT NULL,
	"status" "ai_evaluation_status" DEFAULT 'draft' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"published_by_user_id" text,
	"evaluated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_evaluations_threshold_check" CHECK ("ai_model_evaluations"."repeat_count" > 0
        AND "ai_model_evaluations"."fabricated_evidence_count" >= 0
        AND "ai_model_evaluations"."evidence_validity_basis_points" BETWEEN 0 AND 10000
        AND "ai_model_evaluations"."false_positive_fulfilled_basis_points" BETWEEN 0 AND 10000
        AND "ai_model_evaluations"."evidence_precision_basis_points" BETWEEN 0 AND 10000
        AND "ai_model_evaluations"."evidence_recall_basis_points" BETWEEN 0 AND 10000
        AND "ai_model_evaluations"."macro_f1_basis_points" BETWEEN 0 AND 10000
        AND "ai_model_evaluations"."schema_reliability_basis_points" BETWEEN 0 AND 10000
        AND "ai_model_evaluations"."german_regulatory_basis_points" BETWEEN 0 AND 10000
        AND ("ai_model_evaluations"."status" <> 'published' OR ("ai_model_evaluations"."published_at" IS NOT NULL AND "ai_model_evaluations"."published_by_user_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "ai_model_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"publisher" text NOT NULL,
	"display_name" text NOT NULL,
	"route_provider" "ai_route_provider" NOT NULL,
	"provider_model_id" text NOT NULL,
	"tasks" text[] NOT NULL,
	"lifecycle" "ai_model_lifecycle" DEFAULT 'unevaluated' NOT NULL,
	"recommendation" "ai_model_recommendation",
	"supports_structured_output" boolean DEFAULT false NOT NULL,
	"supports_streaming" boolean DEFAULT false NOT NULL,
	"context_window" integer,
	"privacy_profile_id" text NOT NULL,
	"evaluation_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_profiles_certification_check" CHECK (("ai_model_profiles"."lifecycle" <> 'certified' OR "ai_model_profiles"."evaluation_version" IS NOT NULL)
        AND ("ai_model_profiles"."recommendation" IS NULL OR "ai_model_profiles"."lifecycle" = 'certified')
        AND cardinality("ai_model_profiles"."tasks") > 0)
);
--> statement-breakpoint
CREATE TABLE "analysis_assessment_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"input_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"retrieval_version" text NOT NULL,
	"privacy_profile_id" text NOT NULL,
	"output" jsonb NOT NULL,
	"output_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_assessment_cache_hash_check" CHECK ("analysis_assessment_cache"."cache_key" ~ '^[0-9a-f]{64}$'
        AND "analysis_assessment_cache"."input_hash" ~ '^[0-9a-f]{64}$'
        AND "analysis_assessment_cache"."output_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "chat_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"citation_order" integer NOT NULL,
	"source_type" "chat_citation_source" NOT NULL,
	"requirement_id" uuid,
	"document_block_id" uuid,
	"source_label" text NOT NULL,
	"source_locator" text,
	"exact_quote" text NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_citations_source_check" CHECK (("chat_citations"."source_type" = 'framework_requirement' AND "chat_citations"."requirement_id" IS NOT NULL AND "chat_citations"."document_block_id" IS NULL)
        OR ("chat_citations"."source_type" = 'policy_block' AND "chat_citations"."document_block_id" IS NOT NULL AND "chat_citations"."requirement_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "chat_message_role" NOT NULL,
	"status" "chat_message_status" DEFAULT 'completed' NOT NULL,
	"content" text NOT NULL,
	"route_provider" text,
	"model_profile_id" text,
	"provider_model_id" text,
	"model_catalogue_version" text,
	"evaluation_version" text,
	"provider_request_id" text,
	"input_hash" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"latency_milliseconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_model_snapshot_check" CHECK (("chat_messages"."role" = 'user' AND "chat_messages"."route_provider" IS NULL AND "chat_messages"."provider_model_id" IS NULL)
        OR ("chat_messages"."role" = 'assistant' AND "chat_messages"."route_provider" IS NOT NULL AND "chat_messages"."provider_model_id" IS NOT NULL AND "chat_messages"."model_catalogue_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"analysis_id" uuid,
	"policy_version_id" uuid,
	"framework_release_id" uuid,
	"title" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delete_after" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chat_threads_title_check" CHECK (length(btrim("chat_threads"."title")) between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "ai_model_evaluations" ADD CONSTRAINT "ai_model_evaluations_model_profile_id_ai_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "public"."ai_model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_evaluations" ADD CONSTRAINT "ai_model_evaluations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_evaluations" ADD CONSTRAINT "ai_model_evaluations_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_assessment_cache" ADD CONSTRAINT "analysis_assessment_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_requirement_id_regulatory_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."regulatory_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_document_block_id_document_blocks_id_fk" FOREIGN KEY ("document_block_id") REFERENCES "public"."document_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_framework_release_id_regulatory_framework_releases_id_fk" FOREIGN KEY ("framework_release_id") REFERENCES "public"."regulatory_framework_releases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_evaluations_profile_version_uidx" ON "ai_model_evaluations" USING btree ("model_profile_id","evaluation_version");--> statement-breakpoint
CREATE INDEX "ai_model_evaluations_status_idx" ON "ai_model_evaluations" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_profiles_route_model_uidx" ON "ai_model_profiles" USING btree ("route_provider","provider_model_id");--> statement-breakpoint
CREATE INDEX "ai_model_profiles_lifecycle_idx" ON "ai_model_profiles" USING btree ("lifecycle","recommendation");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_assessment_cache_org_key_uidx" ON "analysis_assessment_cache" USING btree ("organization_id","cache_key");--> statement-breakpoint
CREATE INDEX "analysis_assessment_cache_expiry_idx" ON "analysis_assessment_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "chat_citations_message_order_idx" ON "chat_citations" USING btree ("message_id","citation_order");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_created_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_threads_owner_updated_idx" ON "chat_threads" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "chat_threads_retention_idx" ON "chat_threads" USING btree ("delete_after","deleted_at");