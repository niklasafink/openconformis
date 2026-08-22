CREATE TYPE "public"."analysis_funding_mode" AS ENUM('sponsored', 'byok');--> statement-breakpoint
CREATE TYPE "public"."analysis_stage" AS ENUM('queued', 'preprocessing', 'retrieval', 'assessment', 'verification', 'finalizing', 'completed');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"source_draft_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"sponsored_grant_id" uuid,
	"framework_slug" text NOT NULL,
	"framework_release_key" text NOT NULL,
	"framework_content_hash" text NOT NULL,
	"institution_size" "institution_size" NOT NULL,
	"organization_context" text DEFAULT '' NOT NULL,
	"locale" text NOT NULL,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"stage" "analysis_stage" DEFAULT 'queued' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"funding_mode" "analysis_funding_mode" NOT NULL,
	"route_provider" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"model_profile_id" text NOT NULL,
	"model_catalogue_version" text NOT NULL,
	"privacy_profile_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"configuration_hash" text NOT NULL,
	"policy_sha256" text NOT NULL,
	"policy_parser_version" text NOT NULL,
	"requirement_count" integer NOT NULL,
	"unevaluated_warning_accepted" boolean DEFAULT false NOT NULL,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_scope_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"requirement_external_key" text NOT NULL,
	"regulatory_id" text NOT NULL,
	"title" text NOT NULL,
	"legal_text" text NOT NULL,
	"assessment_aspects" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"source_locator" text,
	"size_guidance" text NOT NULL,
	"subrequirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"display_order" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_source_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("source_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_sponsored_grant_id_sponsored_run_grants_id_fk" FOREIGN KEY ("sponsored_grant_id") REFERENCES "public"."sponsored_run_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_scope_items" ADD CONSTRAINT "analysis_scope_items_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_source_draft_uidx" ON "analyses" USING btree ("source_draft_id");--> statement-breakpoint
CREATE INDEX "analyses_organization_created_at_idx" ON "analyses" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_status_created_at_idx" ON "analyses" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "analyses_owner_created_at_idx" ON "analyses" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_scope_items_analysis_requirement_uidx" ON "analysis_scope_items" USING btree ("analysis_id","requirement_external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_scope_items_analysis_order_uidx" ON "analysis_scope_items" USING btree ("analysis_id","display_order");--> statement-breakpoint
CREATE INDEX "analysis_scope_items_analysis_idx" ON "analysis_scope_items" USING btree ("analysis_id");