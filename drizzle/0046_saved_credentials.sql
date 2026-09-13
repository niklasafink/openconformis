CREATE TABLE "ai_saved_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider" "ai_route_provider" NOT NULL,
	"encrypted_secret" text NOT NULL,
	"nonce" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"secret_last_four" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_saved_credentials_identity_check" CHECK ("ai_saved_credentials"."encryption_key_version" > 0 AND length("ai_saved_credentials"."secret_last_four") = 4)
);
--> statement-breakpoint
ALTER TABLE "ai_saved_credentials" ADD CONSTRAINT "ai_saved_credentials_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_saved_credentials_owner_provider_uidx" ON "ai_saved_credentials" USING btree ("owner_user_id","provider");