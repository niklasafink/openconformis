CREATE TYPE "public"."framework_availability" AS ENUM('included', 'locked');--> statement-breakpoint
CREATE TYPE "public"."framework_content_classification" AS ENUM('demo', 'official_source', 'derived_mapping');--> statement-breakpoint
CREATE TYPE "public"."framework_release_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "regulatory_framework_localizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"framework_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"name" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_framework_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"framework_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" "framework_release_status" DEFAULT 'draft' NOT NULL,
	"authoritative_language" text NOT NULL,
	"effective_from" date,
	"effective_until" date,
	"source_title" text NOT NULL,
	"source_url" text,
	"source_locator" text,
	"source_retrieved_at" timestamp with time zone,
	"content_classification" "framework_content_classification" DEFAULT 'demo' NOT NULL,
	"provenance_note" text NOT NULL,
	"reuse_notice" text NOT NULL,
	"content_hash" text,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_frameworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"region" text NOT NULL,
	"availability" "framework_availability" DEFAULT 'locked' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"regulatory_id" text NOT NULL,
	"title" text NOT NULL,
	"legal_text" text NOT NULL,
	"assessment_aspects" text[] NOT NULL,
	"source_locator" text,
	"small_institution_guidance" text NOT NULL,
	"medium_institution_guidance" text NOT NULL,
	"large_institution_guidance" text NOT NULL,
	"display_order" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulatory_subrequirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"parent_requirement_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"regulatory_id" text NOT NULL,
	"title" text NOT NULL,
	"legal_text" text NOT NULL,
	"assessment_aspects" text[] NOT NULL,
	"source_locator" text,
	"small_institution_guidance" text NOT NULL,
	"medium_institution_guidance" text NOT NULL,
	"large_institution_guidance" text NOT NULL,
	"display_order" integer NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regulatory_framework_localizations" ADD CONSTRAINT "regulatory_framework_localizations_framework_id_regulatory_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."regulatory_frameworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_framework_releases" ADD CONSTRAINT "regulatory_framework_releases_framework_id_regulatory_frameworks_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."regulatory_frameworks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_framework_releases" ADD CONSTRAINT "regulatory_framework_releases_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_requirements" ADD CONSTRAINT "regulatory_requirements_release_id_regulatory_framework_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."regulatory_framework_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_subrequirements" ADD CONSTRAINT "regulatory_subrequirements_release_id_regulatory_framework_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."regulatory_framework_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_subrequirements" ADD CONSTRAINT "regulatory_subrequirements_parent_requirement_id_regulatory_requirements_id_fk" FOREIGN KEY ("parent_requirement_id") REFERENCES "public"."regulatory_requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_framework_localizations_framework_locale_uidx" ON "regulatory_framework_localizations" USING btree ("framework_id","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_framework_releases_framework_version_uidx" ON "regulatory_framework_releases" USING btree ("framework_id","version");--> statement-breakpoint
CREATE INDEX "regulatory_framework_releases_lookup_idx" ON "regulatory_framework_releases" USING btree ("framework_id","status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_frameworks_slug_uidx" ON "regulatory_frameworks" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "regulatory_frameworks_availability_idx" ON "regulatory_frameworks" USING btree ("availability","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_requirements_release_key_uidx" ON "regulatory_requirements" USING btree ("release_id","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_requirements_release_order_uidx" ON "regulatory_requirements" USING btree ("release_id","display_order");--> statement-breakpoint
CREATE INDEX "regulatory_requirements_release_idx" ON "regulatory_requirements" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_subrequirements_parent_key_uidx" ON "regulatory_subrequirements" USING btree ("parent_requirement_id","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "regulatory_subrequirements_parent_order_uidx" ON "regulatory_subrequirements" USING btree ("parent_requirement_id","display_order");--> statement-breakpoint
CREATE INDEX "regulatory_subrequirements_release_idx" ON "regulatory_subrequirements" USING btree ("release_id");