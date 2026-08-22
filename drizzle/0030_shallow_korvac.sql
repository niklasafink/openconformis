ALTER TABLE "chat_citations" DROP CONSTRAINT "chat_citations_source_check";--> statement-breakpoint
ALTER TABLE "chat_citations" ADD CONSTRAINT "chat_citations_source_check" CHECK (("chat_citations"."source_type" = 'framework_requirement' AND "chat_citations"."document_block_id" IS NULL)
        OR ("chat_citations"."source_type" = 'policy_block' AND "chat_citations"."requirement_id" IS NULL));