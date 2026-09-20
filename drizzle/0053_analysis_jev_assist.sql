ALTER TABLE "analyses" ADD COLUMN "jev_assist_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "jev_model_id" text;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "jev_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_jev_credential_id_ai_credentials_id_fk" FOREIGN KEY ("jev_credential_id") REFERENCES "public"."ai_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_jev_assist_mode_check" CHECK ("analyses"."jev_assist_mode" in ('off', 'retrieval', 'verification', 'all'));--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_jev_assist_frozen_check" CHECK ("analyses"."jev_assist_mode" = 'off' or ("analyses"."jev_model_id" is not null and "analyses"."jev_credential_id" is not null));