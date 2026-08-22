ALTER TYPE "public"."chat_citation_source" ADD VALUE 'framework_subrequirement' BEFORE 'policy_block';--> statement-breakpoint
ALTER TABLE "chat_citations" DROP CONSTRAINT "chat_citations_source_check";--> statement-breakpoint
ALTER TABLE "chat_citations" ADD COLUMN "subrequirement_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_subrequirement_id_regulatory_subrequirements_id_fk" FOREIGN KEY ("subrequirement_id") REFERENCES "public"."regulatory_subrequirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_source_check" CHECK (("chat_citations"."source_type" = 'framework_requirement' AND "chat_citations"."subrequirement_id" IS NULL AND "chat_citations"."document_block_id" IS NULL)
        OR ("chat_citations"."source_type" = 'framework_subrequirement' AND "chat_citations"."requirement_id" IS NULL AND "chat_citations"."document_block_id" IS NULL)
        OR ("chat_citations"."source_type" = 'policy_block' AND "chat_citations"."requirement_id" IS NULL AND "chat_citations"."subrequirement_id" IS NULL));