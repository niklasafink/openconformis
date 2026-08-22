CREATE TYPE "public"."document_block_type" AS ENUM('title', 'heading', 'paragraph', 'list_item', 'table_cell');--> statement-breakpoint
CREATE TYPE "public"."policy_lifecycle_status" AS ENUM('active', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."policy_parse_status" AS ENUM('awaiting_upload', 'uploaded', 'validating', 'quarantined', 'parsing', 'needs_ocr', 'needs_ocr_review', 'ready', 'failed', 'deleting', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."policy_upload_intent_status" AS ENUM('issued', 'uploaded', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."policy_version_source" AS ENUM('sample', 'upload');--> statement-breakpoint
CREATE TABLE "document_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"block_key" text NOT NULL,
	"ordinal" integer NOT NULL,
	"block_type" "document_block_type" NOT NULL,
	"canonical_text" text NOT NULL,
	"page_number" integer,
	"paragraph_number" integer,
	"heading_path" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"token_count" integer,
	"text_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_policy_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_draft_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"anonymous_draft_id" uuid,
	"display_name" text NOT NULL,
	"lifecycle_status" "policy_lifecycle_status" DEFAULT 'active' NOT NULL,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policy_upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_draft_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"status" "policy_upload_intent_status" DEFAULT 'issued' NOT NULL,
	"object_key" text NOT NULL,
	"declared_filename" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_byte_size" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"organization_id" text,
	"anonymous_draft_id" uuid,
	"version_number" integer NOT NULL,
	"source" "policy_version_source" NOT NULL,
	"original_filename" text NOT NULL,
	"detected_mime_type" text,
	"declared_mime_type" text,
	"byte_size" integer,
	"sha256" text,
	"storage_driver" text NOT NULL,
	"object_key" text NOT NULL,
	"object_etag" text,
	"parser_version" text,
	"parse_status" "policy_parse_status" DEFAULT 'awaiting_upload' NOT NULL,
	"parse_error_code" text,
	"page_count" integer,
	"authoritative_language" text,
	"provenance_note" text,
	"reuse_notice" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"original_delete_after" timestamp with time zone NOT NULL,
	"parsed_delete_after" timestamp with time zone NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "document_blocks" ADD CONSTRAINT "document_blocks_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_policy_selections" ADD CONSTRAINT "draft_policy_selections_anonymous_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("anonymous_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_policy_selections" ADD CONSTRAINT "draft_policy_selections_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_anonymous_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("anonymous_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_upload_intents" ADD CONSTRAINT "policy_upload_intents_anonymous_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("anonymous_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_upload_intents" ADD CONSTRAINT "policy_upload_intents_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_anonymous_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("anonymous_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_blocks_version_key_uidx" ON "document_blocks" USING btree ("policy_version_id","block_key");--> statement-breakpoint
CREATE UNIQUE INDEX "document_blocks_version_ordinal_uidx" ON "document_blocks" USING btree ("policy_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_blocks_policy_version_idx" ON "document_blocks" USING btree ("policy_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_policy_selections_draft_uidx" ON "draft_policy_selections" USING btree ("anonymous_draft_id");--> statement-breakpoint
CREATE INDEX "draft_policy_selections_version_idx" ON "draft_policy_selections" USING btree ("policy_version_id");--> statement-breakpoint
CREATE INDEX "policies_organization_created_at_idx" ON "policies" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "policies_anonymous_draft_idx" ON "policies" USING btree ("anonymous_draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_upload_intents_object_key_uidx" ON "policy_upload_intents" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "policy_upload_intents_draft_status_idx" ON "policy_upload_intents" USING btree ("anonymous_draft_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_policy_version_uidx" ON "policy_versions" USING btree ("policy_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_object_key_uidx" ON "policy_versions" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_org_hash_parser_uidx" ON "policy_versions" USING btree ("organization_id","sha256","parser_version") WHERE "policy_versions"."organization_id" is not null and "policy_versions"."sha256" is not null and "policy_versions"."parser_version" is not null;--> statement-breakpoint
CREATE INDEX "policy_versions_parse_status_idx" ON "policy_versions" USING btree ("parse_status","created_at");--> statement-breakpoint
CREATE INDEX "policy_versions_original_cleanup_idx" ON "policy_versions" USING btree ("original_delete_after","parse_status");--> statement-breakpoint
CREATE INDEX "policy_versions_parsed_cleanup_idx" ON "policy_versions" USING btree ("parsed_delete_after","parse_status");