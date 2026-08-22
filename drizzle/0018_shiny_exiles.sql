CREATE TABLE "analysis_retrieval_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"scope_item_id" uuid NOT NULL,
	"retrieval_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"token_count" integer NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_retrieval_packets" ADD CONSTRAINT "analysis_retrieval_packets_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_retrieval_packets" ADD CONSTRAINT "analysis_retrieval_packets_scope_item_id_analysis_scope_items_id_fk" FOREIGN KEY ("scope_item_id") REFERENCES "public"."analysis_scope_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_retrieval_packets_scope_item_uidx" ON "analysis_retrieval_packets" USING btree ("scope_item_id");--> statement-breakpoint
CREATE INDEX "analysis_retrieval_packets_analysis_idx" ON "analysis_retrieval_packets" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "analysis_retrieval_packets_output_hash_idx" ON "analysis_retrieval_packets" USING btree ("output_hash");