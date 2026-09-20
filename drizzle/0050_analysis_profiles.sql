CREATE TYPE "public"."analysis_profile" AS ENUM('auditor', 'institution');--> statement-breakpoint
ALTER TYPE "public"."analysis_instruction_kind" ADD VALUE 'finding';--> statement-breakpoint
ALTER TYPE "public"."analysis_instruction_kind" ADD VALUE 'remediation';--> statement-breakpoint
CREATE TABLE "user_analysis_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"analysis_profile" "analysis_profile" DEFAULT 'auditor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_requirement_conclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"profile" "analysis_profile" NOT NULL,
	"summary" text NOT NULL,
	"items" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"resolved_items" integer[] DEFAULT ARRAY[]::integer[] NOT NULL,
	"model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_requirement_conclusions_summary_check" CHECK (length(btrim("analysis_requirement_conclusions"."summary")) between 20 and 4000)
);
--> statement-breakpoint
ALTER TABLE "draft_analysis_scopes" ADD COLUMN "analysis_profile" "analysis_profile" DEFAULT 'auditor' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "analysis_profile" "analysis_profile" DEFAULT 'auditor' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "conclusion_prompt_version" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "conclusion_instruction_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "conclusion_instruction_hash" text;--> statement-breakpoint
ALTER TABLE "user_analysis_preferences" ADD CONSTRAINT "user_analysis_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_requirement_conclusions" ADD CONSTRAINT "analysis_requirement_conclusions_result_id_analysis_requirement_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."analysis_requirement_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_requirement_conclusions_result_uidx" ON "analysis_requirement_conclusions" USING btree ("result_id");--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_conclusion_instruction_id_analysis_instructions_id_fk" FOREIGN KEY ("conclusion_instruction_id") REFERENCES "public"."analysis_instructions"("id") ON DELETE restrict ON UPDATE no action;