CREATE TYPE "public"."disclosure_finding_event_kind" AS ENUM('ai_finding', 'comment', 'accepted', 'confirmed', 'released', 'rejected');--> statement-breakpoint
CREATE TABLE "disclosure_finding_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"accepted_value_micro" bigint NOT NULL,
	"accepted_raw_text" text NOT NULL,
	"proposed_value_micro" bigint,
	"reason" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "disclosure_finding_corrections_reason_check" CHECK ("disclosure_finding_corrections"."reason" IS NULL OR length("disclosure_finding_corrections"."reason") BETWEEN 1 AND 2000),
	CONSTRAINT "disclosure_finding_corrections_raw_check" CHECK (length("disclosure_finding_corrections"."accepted_raw_text") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "disclosure_finding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"kind" "disclosure_finding_event_kind" NOT NULL,
	"actor_user_id" text,
	"body" text,
	"correction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_finding_events_body_check" CHECK ("disclosure_finding_events"."body" IS NULL OR length("disclosure_finding_events"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "disclosure_finding_events_actor_check" CHECK ("disclosure_finding_events"."kind" = 'ai_finding' OR "disclosure_finding_events"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "disclosure_finding_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"mentioned_user_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disclosure_finding_corrections" ADD CONSTRAINT "disclosure_finding_corrections_finding_id_disclosure_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."disclosure_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_finding_corrections" ADD CONSTRAINT "disclosure_finding_corrections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_finding_events" ADD CONSTRAINT "disclosure_finding_events_finding_id_disclosure_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."disclosure_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_finding_events" ADD CONSTRAINT "disclosure_finding_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_finding_events" ADD CONSTRAINT "disclosure_finding_events_correction_id_disclosure_finding_corrections_id_fk" FOREIGN KEY ("correction_id") REFERENCES "public"."disclosure_finding_corrections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_finding_mentions" ADD CONSTRAINT "disclosure_finding_mentions_event_id_disclosure_finding_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."disclosure_finding_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_finding_mentions" ADD CONSTRAINT "disclosure_finding_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_finding_corrections_active_uidx" ON "disclosure_finding_corrections" USING btree ("finding_id") WHERE "disclosure_finding_corrections"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "disclosure_finding_events_finding_idx" ON "disclosure_finding_events" USING btree ("finding_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_finding_mentions_event_user_uidx" ON "disclosure_finding_mentions" USING btree ("event_id","mentioned_user_id");