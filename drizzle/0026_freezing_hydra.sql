ALTER TABLE "analyses" ADD COLUMN "ai_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_ai_credential_id_ai_credentials_id_fk" FOREIGN KEY ("ai_credential_id") REFERENCES "public"."ai_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analyses_ai_credential_uidx" ON "analyses" USING btree ("ai_credential_id") WHERE "analyses"."ai_credential_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP CONSTRAINT "analyses_funding_grant_check";--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_funding_grant_check"
CHECK (
	("funding_mode" = 'sponsored' AND "sponsored_grant_id" IS NOT NULL AND "ai_credential_id" IS NULL)
	OR ("funding_mode" = 'byok' AND "sponsored_grant_id" IS NULL AND "ai_credential_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP CONSTRAINT "analyses_provider_route_check";--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_provider_route_check"
CHECK (
	"route_provider" <> 'openrouter'
	OR ("funding_mode" = 'sponsored' AND cardinality("provider_route_allowlist") = 1)
	OR ("funding_mode" = 'byok' AND cardinality("provider_route_allowlist") = 0)
);--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP CONSTRAINT "analyses_verifier_provider_route_check";--> statement-breakpoint
ALTER TABLE "public"."analyses"
ADD CONSTRAINT "analyses_verifier_provider_route_check"
CHECK (
	"route_provider" <> 'openrouter'
	OR ("funding_mode" = 'sponsored' AND cardinality("verifier_provider_route_allowlist") = 1)
	OR ("funding_mode" = 'byok' AND cardinality("verifier_provider_route_allowlist") = 0)
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_ownership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	draft_status "public"."anonymous_draft_status";
	draft_user_id text;
	policy_organization_id text;
	grant_user_id text;
	credential_user_id text;
	credential_purpose "public"."ai_credential_purpose";
	credential_binding_id text;
	credential_provider "public"."ai_route_provider";
	credential_status "public"."ai_credential_status";
	credential_models text[];
BEGIN
	SELECT "status", "claimed_by_user_id"
	INTO draft_status, draft_user_id
	FROM "public"."anonymous_drafts"
	WHERE "id" = NEW."source_draft_id";

	IF draft_status <> 'claimed' OR draft_user_id IS DISTINCT FROM NEW."owner_user_id" THEN
		RAISE EXCEPTION 'analysis source draft is not claimed by the owner';
	END IF;

	SELECT "organization_id"
	INTO policy_organization_id
	FROM "public"."policy_versions"
	WHERE "id" = NEW."policy_version_id";

	IF policy_organization_id IS DISTINCT FROM NEW."organization_id" THEN
		RAISE EXCEPTION 'analysis policy is not owned by the organization';
	END IF;

	IF NEW."sponsored_grant_id" IS NOT NULL THEN
		SELECT "user_id"
		INTO grant_user_id
		FROM "public"."sponsored_run_grants"
		WHERE "id" = NEW."sponsored_grant_id";

		IF grant_user_id IS DISTINCT FROM NEW."owner_user_id" THEN
			RAISE EXCEPTION 'analysis sponsored grant is not owned by the user';
		END IF;
	END IF;

	IF NEW."ai_credential_id" IS NOT NULL THEN
		SELECT "owner_user_id", "purpose", "binding_id", "provider", "status", "accessible_model_ids"
		INTO credential_user_id, credential_purpose, credential_binding_id, credential_provider, credential_status, credential_models
		FROM "public"."ai_credentials"
		WHERE "id" = NEW."ai_credential_id";

		IF credential_user_id IS DISTINCT FROM NEW."owner_user_id"
			OR credential_purpose IS DISTINCT FROM 'analysis'
			OR credential_binding_id IS DISTINCT FROM NEW."source_draft_id"::text
			OR credential_provider::text IS DISTINCT FROM NEW."route_provider"
			OR credential_status IS DISTINCT FROM 'active'
			OR NOT (NEW."provider_model_id" = ANY(credential_models))
		THEN
			RAISE EXCEPTION 'analysis AI credential does not match the frozen run';
		END IF;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER "analyses_enforce_ownership" ON "public"."analyses";--> statement-breakpoint
CREATE TRIGGER "analyses_enforce_ownership"
BEFORE INSERT OR UPDATE OF "organization_id", "owner_user_id", "source_draft_id", "policy_version_id", "sponsored_grant_id", "ai_credential_id", "funding_mode", "route_provider", "provider_model_id"
ON "public"."analyses"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_ownership"();
