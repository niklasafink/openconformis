CREATE TYPE "public"."institution_size" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "draft_analysis_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_draft_id" uuid NOT NULL,
	"framework_slug" text NOT NULL,
	"framework_release_key" text NOT NULL,
	"framework_content_hash" text NOT NULL,
	"institution_size" "institution_size" NOT NULL,
	"organization_context" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_requirement_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_scope_id" uuid NOT NULL,
	"requirement_external_key" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_analysis_scopes" ADD CONSTRAINT "draft_analysis_scopes_anonymous_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("anonymous_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_requirement_selections" ADD CONSTRAINT "draft_requirement_selections_draft_scope_id_draft_analysis_scopes_id_fk" FOREIGN KEY ("draft_scope_id") REFERENCES "public"."draft_analysis_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_analysis_scopes_draft_uidx" ON "draft_analysis_scopes" USING btree ("anonymous_draft_id");--> statement-breakpoint
CREATE INDEX "draft_analysis_scopes_release_idx" ON "draft_analysis_scopes" USING btree ("framework_slug","framework_content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_requirement_selections_scope_requirement_uidx" ON "draft_requirement_selections" USING btree ("draft_scope_id","requirement_external_key");--> statement-breakpoint
CREATE INDEX "draft_requirement_selections_scope_idx" ON "draft_requirement_selections" USING btree ("draft_scope_id");