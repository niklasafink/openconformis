CREATE TYPE "public"."disclosure_case_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."disclosure_document_role" AS ENUM('report', 'prior_report', 'evidence');--> statement-breakpoint
CREATE TABLE "disclosure_case_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"role" "disclosure_document_role" NOT NULL,
	"policy_version_id" uuid,
	"evidence_file_id" uuid,
	"ordinal" integer NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_case_documents_source_check" CHECK (("disclosure_case_documents"."policy_version_id" IS NOT NULL) <> ("disclosure_case_documents"."evidence_file_id" IS NOT NULL)
        AND ("disclosure_case_documents"."role" <> 'evidence' OR "disclosure_case_documents"."evidence_file_id" IS NOT NULL)
        AND ("disclosure_case_documents"."role" = 'evidence' OR "disclosure_case_documents"."policy_version_id" IS NOT NULL)),
	CONSTRAINT "disclosure_case_documents_name_check" CHECK (length(btrim("disclosure_case_documents"."display_name")) between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "disclosure_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "disclosure_case_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disclosure_cases_title_check" CHECK (length(btrim("disclosure_cases"."title")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD CONSTRAINT "disclosure_case_documents_case_id_disclosure_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."disclosure_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_case_documents" ADD CONSTRAINT "disclosure_case_documents_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_cases" ADD CONSTRAINT "disclosure_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosure_cases" ADD CONSTRAINT "disclosure_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_case_documents_case_ordinal_uidx" ON "disclosure_case_documents" USING btree ("case_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_case_documents_case_version_uidx" ON "disclosure_case_documents" USING btree ("case_id","policy_version_id") WHERE "disclosure_case_documents"."policy_version_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_case_documents_one_report_uidx" ON "disclosure_case_documents" USING btree ("case_id") WHERE "disclosure_case_documents"."role" = 'report';--> statement-breakpoint
CREATE INDEX "disclosure_case_documents_version_idx" ON "disclosure_case_documents" USING btree ("policy_version_id");--> statement-breakpoint
CREATE INDEX "disclosure_cases_organization_updated_idx" ON "disclosure_cases" USING btree ("organization_id","updated_at");