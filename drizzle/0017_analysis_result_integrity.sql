ALTER TABLE "public"."analysis_requirement_results"
ADD CONSTRAINT "analysis_requirement_results_content_check"
CHECK (
  length(btrim("explanation")) > 0
  AND "confidence_basis_points" BETWEEN 0 AND 10000
  AND "input_hash" ~ '^[0-9a-f]{64}$'
  AND "output_hash" ~ '^[0-9a-f]{64}$'
  AND (
    ("status" = 'no_assessment_possible' AND cardinality("missing_information") > 0)
    OR "status" <> 'no_assessment_possible'
  )
  AND (
    ("confirmed_by_user_id" IS NULL AND "confirmed_at" IS NULL)
    OR ("confirmed_by_user_id" IS NOT NULL AND "confirmed_at" IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "public"."analysis_evidence"
ADD CONSTRAINT "analysis_evidence_content_check"
CHECK (
  "citation_order" > 0
  AND length(btrim("exact_quote")) > 0
  AND "block_text_hash" ~ '^[0-9a-f]{64}$'
  AND ("page_number" IS NULL OR "page_number" > 0)
  AND ("paragraph_number" IS NULL OR "paragraph_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "public"."analysis_model_invocations"
ADD CONSTRAINT "analysis_model_invocations_lifecycle_check"
CHECK (
  "input_hash" ~ '^[0-9a-f]{64}$'
  AND ("output_hash" IS NULL OR "output_hash" ~ '^[0-9a-f]{64}$')
  AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
  AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
  AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
  AND ("reasoning_tokens" IS NULL OR "reasoning_tokens" >= 0)
  AND ("cost_microunits" IS NULL OR "cost_microunits" >= 0)
  AND ("latency_milliseconds" IS NULL OR "latency_milliseconds" >= 0)
  AND (
    ("status" = 'started' AND "completed_at" IS NULL AND "error_code" IS NULL)
    OR (
      "status" = 'succeeded'
      AND "completed_at" IS NOT NULL
      AND "output_hash" IS NOT NULL
      AND "error_code" IS NULL
    )
    OR ("status" = 'failed' AND "completed_at" IS NOT NULL AND "error_code" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_result_scope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scope_analysis_id uuid;
BEGIN
  SELECT "analysis_id"
  INTO scope_analysis_id
  FROM "public"."analysis_scope_items"
  WHERE "id" = NEW."scope_item_id";

  IF scope_analysis_id IS DISTINCT FROM NEW."analysis_id" THEN
    RAISE EXCEPTION 'analysis result and scope item must belong to the same analysis';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "analysis_results_enforce_scope"
BEFORE INSERT OR UPDATE OF "analysis_id", "scope_item_id"
ON "public"."analysis_requirement_results"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_result_scope"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_evidence_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_policy_version_id uuid;
  actual_policy_version_id uuid;
  actual_text text;
  actual_text_hash text;
BEGIN
  SELECT analyses."policy_version_id"
  INTO expected_policy_version_id
  FROM "public"."analysis_requirement_results" AS results
  JOIN "public"."analyses" AS analyses ON analyses."id" = results."analysis_id"
  WHERE results."id" = NEW."result_id";

  SELECT blocks."policy_version_id", blocks."canonical_text", blocks."text_hash"
  INTO actual_policy_version_id, actual_text, actual_text_hash
  FROM "public"."document_blocks" AS blocks
  WHERE blocks."id" = NEW."document_block_id";

  IF expected_policy_version_id IS DISTINCT FROM actual_policy_version_id THEN
    RAISE EXCEPTION 'evidence block does not belong to the analyzed policy version';
  END IF;

  IF NEW."block_text_hash" IS DISTINCT FROM actual_text_hash THEN
    RAISE EXCEPTION 'evidence block hash does not match the immutable document block';
  END IF;

  IF position(
    regexp_replace(NEW."exact_quote", '\\s+', ' ', 'g')
    IN regexp_replace(actual_text, '\\s+', ' ', 'g')
  ) = 0 THEN
    RAISE EXCEPTION 'evidence quote is not present in the immutable document block';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "analysis_evidence_enforce_provenance"
BEFORE INSERT OR UPDATE OF "result_id", "document_block_id", "exact_quote", "block_text_hash"
ON "public"."analysis_evidence"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_evidence_provenance"();
