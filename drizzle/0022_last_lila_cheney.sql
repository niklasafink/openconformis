CREATE TYPE "public"."ai_credential_purpose" AS ENUM('analysis', 'chat');--> statement-breakpoint
CREATE TYPE "public"."ai_credential_status" AS ENUM('active', 'revoked', 'expired', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."ai_route_provider" AS ENUM('openrouter', 'requesty', 'anthropic', 'google', 'openai');--> statement-breakpoint
CREATE TABLE "ai_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"organization_id" text,
	"session_id" text NOT NULL,
	"provider" "ai_route_provider" NOT NULL,
	"purpose" "ai_credential_purpose" NOT NULL,
	"binding_id" text NOT NULL,
	"status" "ai_credential_status" DEFAULT 'active' NOT NULL,
	"encrypted_secret" text,
	"nonce" text,
	"authentication_tag" text,
	"encryption_key_version" integer NOT NULL,
	"secret_last_four" text NOT NULL,
	"safe_label" text,
	"accessible_model_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"model_access_hash" text NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_credentials_owner_status_idx" ON "ai_credentials" USING btree ("owner_user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "ai_credentials_expiry_idx" ON "ai_credentials" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "ai_credentials_binding_idx" ON "ai_credentials" USING btree ("owner_user_id","purpose","binding_id");