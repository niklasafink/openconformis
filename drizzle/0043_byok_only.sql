-- Jeder Analyse-Lauf läuft über den eigenen, kurzlebig hinterlegten Schlüssel
-- des Nutzers. Das Betreiber-Kontingent („ein Gratislauf je Konto") entfällt
-- samt Reservierung, Verbrauch und Anbieterfestlegung. Läufe aus dieser Zeit
-- bleiben lesbar; nur ihre Kontingent-Verknüpfung geht verloren.
ALTER TABLE "public"."analyses" DROP CONSTRAINT IF EXISTS "analyses_funding_grant_check";--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP CONSTRAINT IF EXISTS "analyses_provider_route_check";--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP CONSTRAINT IF EXISTS "analyses_verifier_provider_route_check";--> statement-breakpoint
DROP INDEX IF EXISTS "analyses_sponsored_grant_uidx";--> statement-breakpoint
-- Der Eigentums-Trigger hängt an den Kontingent-Spalten; er muss ohne sie neu
-- angelegt werden, bevor die Spalten fallen können.
CREATE OR REPLACE FUNCTION "public"."enforce_analysis_ownership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	draft_status "public"."anonymous_draft_status";
	draft_user_id text;
	policy_organization_id text;
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
DROP TRIGGER IF EXISTS "analyses_enforce_ownership" ON "public"."analyses";--> statement-breakpoint
CREATE TRIGGER "analyses_enforce_ownership"
BEFORE INSERT OR UPDATE OF "organization_id", "owner_user_id", "source_draft_id", "policy_version_id", "ai_credential_id", "route_provider", "provider_model_id"
ON "public"."analyses"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_analysis_ownership"();--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP CONSTRAINT IF EXISTS "analyses_sponsored_grant_id_sponsored_run_grants_id_fk";--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP COLUMN IF EXISTS "sponsored_grant_id";--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP COLUMN IF EXISTS "funding_mode";--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP COLUMN IF EXISTS "provider_route_allowlist";--> statement-breakpoint
ALTER TABLE "public"."analyses" DROP COLUMN IF EXISTS "verifier_provider_route_allowlist";--> statement-breakpoint
DROP TABLE IF EXISTS "public"."sponsored_run_grants";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."analysis_funding_mode";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."sponsored_grant_status";
