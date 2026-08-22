CREATE TYPE "public"."analysis_verification_verdict" AS ENUM('confirm', 'reject', 'uncertain');--> statement-breakpoint
ALTER TYPE "public"."analysis_verification_status" ADD VALUE 'not_selected' BEFORE 'passed';--> statement-breakpoint
CREATE TABLE "analysis_requirement_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"selection_reasons" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"proposed_status" "analysis_result_status" NOT NULL,
	"proposed_explanation" text NOT NULL,
	"proposed_confidence_basis_points" integer NOT NULL,
	"verdict" "analysis_verification_verdict" NOT NULL,
	"explanation" text NOT NULL,
	"unsupported_claims" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"missing_mandatory_aspects" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"verifier_model_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "verifier_provider_model_id" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "verifier_model_profile_id" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "verifier_provider_route_allowlist" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "verifier_prompt_version" text;--> statement-breakpoint
UPDATE "analyses"
SET
	"verifier_provider_model_id" = "provider_model_id",
	"verifier_model_profile_id" = "model_profile_id",
	"verifier_provider_route_allowlist" = "provider_route_allowlist",
	"verifier_prompt_version" = 'verification-v1';--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "verifier_provider_model_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "verifier_model_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "verifier_prompt_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_requirement_verifications" ADD CONSTRAINT "analysis_requirement_verifications_result_id_analysis_requirement_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."analysis_requirement_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_requirement_verifications_result_uidx" ON "analysis_requirement_verifications" USING btree ("result_id");--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_verifier_provider_route_check"
CHECK (
	"route_provider" <> 'openrouter'
	OR cardinality("verifier_provider_route_allowlist") = 1
);--> statement-breakpoint
ALTER TABLE "public"."analysis_requirement_verifications"
ADD CONSTRAINT "analysis_requirement_verifications_content_check"
CHECK (
	cardinality("selection_reasons") > 0
	AND length(btrim("proposed_explanation")) > 0
	AND "proposed_confidence_basis_points" BETWEEN 0 AND 10000
	AND length(btrim("explanation")) > 0
	AND length(btrim("verifier_model_id")) > 0
	AND length(btrim("prompt_version")) > 0
	AND "input_hash" ~ '^[0-9a-f]{64}$'
	AND "output_hash" ~ '^[0-9a-f]{64}$'
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_verification_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_result_id uuid;
	result_status analysis_result_status;
	verification_status analysis_verification_status;
	proposed_status analysis_result_status;
	verification_verdict analysis_verification_verdict;
BEGIN
	target_result_id := CASE
		WHEN TG_TABLE_NAME = 'analysis_requirement_results' THEN NEW."id"
		ELSE NEW."result_id"
	END;

	SELECT results."status", results."verification_status"
	INTO result_status, verification_status
	FROM "public"."analysis_requirement_results" AS results
	WHERE results."id" = target_result_id;

	SELECT verifications."proposed_status", verifications."verdict"
	INTO proposed_status, verification_verdict
	FROM "public"."analysis_requirement_verifications" AS verifications
	WHERE verifications."result_id" = target_result_id;

	IF verification_status = 'passed' THEN
		IF verification_verdict IS DISTINCT FROM 'confirm' OR result_status IS DISTINCT FROM proposed_status THEN
			RAISE EXCEPTION 'passed verification must confirm the persisted proposed result';
		END IF;
	ELSIF verification_status = 'rejected' THEN
		IF verification_verdict IS DISTINCT FROM 'reject' OR result_status <> 'no_assessment_possible' THEN
			RAISE EXCEPTION 'rejected verification must produce no assessment';
		END IF;
	ELSIF verification_status = 'needs_review' AND verification_verdict IS NOT NULL THEN
		IF verification_verdict <> 'uncertain' OR result_status <> 'no_assessment_possible' THEN
			RAISE EXCEPTION 'uncertain verification must require review and produce no assessment';
		END IF;
	ELSIF verification_status IN ('pending', 'not_selected') AND verification_verdict IS NOT NULL THEN
		RAISE EXCEPTION 'pending or non-selected results cannot have a verification record';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "analysis_results_verification_consistency"
AFTER INSERT OR UPDATE OF "status", "verification_status"
ON "public"."analysis_requirement_results"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_verification_consistency"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "analysis_verifications_result_consistency"
AFTER INSERT OR UPDATE OF "result_id", "proposed_status", "verdict"
ON "public"."analysis_requirement_verifications"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_verification_consistency"();
