CREATE TABLE "analysis_result_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"status" "analysis_result_status" NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_result_overrides_reason_length_check" CHECK (length(btrim("analysis_result_overrides"."reason")) between 8 and 2000)
);
--> statement-breakpoint
ALTER TABLE "analysis_result_overrides" ADD CONSTRAINT "analysis_result_overrides_result_id_analysis_requirement_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."analysis_requirement_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_result_overrides" ADD CONSTRAINT "analysis_result_overrides_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_result_overrides_result_created_idx" ON "analysis_result_overrides" USING btree ("result_id","created_at");