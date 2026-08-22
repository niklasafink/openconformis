CREATE TABLE "draft_model_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_draft_id" uuid NOT NULL,
	"route_provider" "ai_route_provider" NOT NULL,
	"model_profile_id" text NOT NULL,
	"provider_model_id" text NOT NULL,
	"model_catalogue_version" text NOT NULL,
	"evaluated" boolean DEFAULT false NOT NULL,
	"unevaluated_warning_accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_model_selections_content_check" CHECK (length(btrim("draft_model_selections"."model_profile_id")) > 0
        AND length(btrim("draft_model_selections"."provider_model_id")) > 0
        AND "draft_model_selections"."model_catalogue_version" ~ '^[0-9a-f]{64}$'
        AND ("draft_model_selections"."evaluated" OR "draft_model_selections"."unevaluated_warning_accepted"))
);
--> statement-breakpoint
ALTER TABLE "draft_model_selections" ADD CONSTRAINT "draft_model_selections_anonymous_draft_id_anonymous_drafts_id_fk" FOREIGN KEY ("anonymous_draft_id") REFERENCES "public"."anonymous_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_model_selections_draft_uidx" ON "draft_model_selections" USING btree ("anonymous_draft_id");