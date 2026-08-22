ALTER TABLE "public"."analysis_retrieval_packets"
ADD CONSTRAINT "analysis_retrieval_packets_content_check"
CHECK (
  "retrieval_version" = 'lexical-bm25-v1'
  AND "input_hash" ~ '^[0-9a-f]{64}$'
  AND "output_hash" ~ '^[0-9a-f]{64}$'
  AND "token_count" BETWEEN 0 AND 6000
  AND jsonb_typeof("candidates") = 'array'
  AND jsonb_array_length("candidates") <= 16
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_retrieval_packet_provenance"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scope_analysis_id uuid;
  expected_policy_version_id uuid;
  candidate jsonb;
  candidate_block_id uuid;
  candidate_policy_version_id uuid;
  candidate_block_key text;
  candidate_text_hash text;
  seen_ranks integer[] := ARRAY[]::integer[];
  candidate_rank integer;
  candidate_score integer;
BEGIN
  SELECT "analysis_id"
  INTO scope_analysis_id
  FROM "public"."analysis_scope_items"
  WHERE "id" = NEW."scope_item_id";

  IF scope_analysis_id IS DISTINCT FROM NEW."analysis_id" THEN
    RAISE EXCEPTION 'retrieval packet and scope item must belong to the same analysis';
  END IF;

  SELECT "policy_version_id"
  INTO expected_policy_version_id
  FROM "public"."analyses"
  WHERE "id" = NEW."analysis_id";

  FOR candidate IN SELECT value FROM jsonb_array_elements(NEW."candidates")
  LOOP
    IF jsonb_typeof(candidate) <> 'object'
      OR jsonb_typeof(candidate->'documentBlockId') <> 'string'
      OR jsonb_typeof(candidate->'blockKey') <> 'string'
      OR jsonb_typeof(candidate->'rank') <> 'number'
      OR jsonb_typeof(candidate->'scoreBasisPoints') <> 'number'
      OR jsonb_typeof(candidate->'role') <> 'string'
      OR jsonb_typeof(candidate->'matchedTerms') <> 'array'
      OR jsonb_typeof(candidate->'blockTextHash') <> 'string'
    THEN
      RAISE EXCEPTION 'retrieval candidate has an invalid shape';
    END IF;

    candidate_block_id := (candidate->>'documentBlockId')::uuid;
    candidate_rank := (candidate->>'rank')::integer;
    candidate_score := (candidate->>'scoreBasisPoints')::integer;

    IF candidate_rank <= 0
      OR candidate_rank = ANY(seen_ranks)
      OR candidate_score NOT BETWEEN 0 AND 10000
      OR candidate->>'role' NOT IN ('match', 'context_before', 'context_after')
      OR candidate->>'blockTextHash' !~ '^[0-9a-f]{64}$'
    THEN
      RAISE EXCEPTION 'retrieval candidate metadata is invalid';
    END IF;
    seen_ranks := array_append(seen_ranks, candidate_rank);

    SELECT "policy_version_id", "block_key", "text_hash"
    INTO candidate_policy_version_id, candidate_block_key, candidate_text_hash
    FROM "public"."document_blocks"
    WHERE "id" = candidate_block_id;

    IF candidate_policy_version_id IS DISTINCT FROM expected_policy_version_id
      OR candidate_block_key IS DISTINCT FROM candidate->>'blockKey'
      OR candidate_text_hash IS DISTINCT FROM candidate->>'blockTextHash'
    THEN
      RAISE EXCEPTION 'retrieval candidate does not match the immutable policy block';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "analysis_retrieval_enforce_provenance"
BEFORE INSERT OR UPDATE OF "analysis_id", "scope_item_id", "candidates"
ON "public"."analysis_retrieval_packets"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_retrieval_packet_provenance"();
