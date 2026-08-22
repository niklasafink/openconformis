import { describe, expect, it } from "vitest";

import { checkProductionConfig } from "./production-config";

function completeEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    APP_ENV: "production",
    CATALOGUE_DRIVER: "database",
    DATABASE_URL: "postgresql://app@database-pooler.example/app?sslmode=require",
    DATABASE_URL_UNPOOLED: "postgresql://migration@database.example/app?sslmode=require",
    APP_BUILD_ID: "v0.1.0",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    NEON_AUTH_BASE_URL: "https://authentication.example.neon.tech",
    NEON_AUTH_COOKIE_SECRET: "a".repeat(32),
    ABUSE_HASH_SECRET: "b".repeat(32),
    STORAGE_DRIVER: "vercel-blob",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_example",
    CRON_SECRET: "c".repeat(32),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SITEVERIFY_WORKER_URL: "https://turnstile.example.workers.dev",
    TURNSTILE_ENFORCED: "true",
    BYOK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    SPONSORED_RUNS_ENABLED: "false",
  };
}

describe("production configuration", () => {
  it("accepts the serverless Vercel configuration", () => {
    expect(checkProductionConfig(completeEnvironment())).toEqual([]);
  });

  it("does not require the migration credential in the web runtime", () => {
    const webEnvironment = completeEnvironment();
    delete webEnvironment.DATABASE_URL_UNPOOLED;
    expect(checkProductionConfig(webEnvironment, "web")).toEqual([]);
  });

  it("fails closed on missing protection and storage controls", () => {
    const environment = completeEnvironment();
    environment.TURNSTILE_ENFORCED = "false";
    environment.BLOB_READ_WRITE_TOKEN = "";
    environment.BYOK_ENCRYPTION_KEY = "not-a-key";

    const variables = checkProductionConfig(environment)
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.variable);

    expect(variables).toEqual(
      expect.arrayContaining(["BLOB_READ_WRITE_TOKEN", "BYOK_ENCRYPTION_KEY"]),
    );
    expect(checkProductionConfig(environment)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variable: "TURNSTILE_ENFORCED", severity: "warning" }),
      ]),
    );
  });

  it("requires Neon Auth endpoint and an independent cookie secret for the web runtime", () => {
    const environment = completeEnvironment();
    delete environment.NEON_AUTH_BASE_URL;
    environment.NEON_AUTH_COOKIE_SECRET = "short";

    const variables = checkProductionConfig(environment, "web")
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.variable);

    expect(variables).toEqual(
      expect.arrayContaining(["NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"]),
    );
  });

  it("rejects reuse of the BYOK encryption key as the Neon Auth cookie secret", () => {
    const environment = completeEnvironment();
    environment.NEON_AUTH_COOKIE_SECRET = environment.BYOK_ENCRYPTION_KEY;

    expect(checkProductionConfig(environment, "web")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variable: "NEON_AUTH_COOKIE_SECRET", severity: "error" }),
      ]),
    );
  });

  it("requires sponsored limits only when sponsorship is enabled", () => {
    const environment = completeEnvironment();
    environment.SPONSORED_RUNS_ENABLED = "true";

    const variables = checkProductionConfig(environment)
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.variable);

    expect(variables).toEqual(
      expect.arrayContaining([
        "SPONSORED_OPENROUTER_API_KEY",
        "SPONSORED_DAILY_RUN_LIMIT",
        "SPONSORED_MAX_CONCURRENCY",
      ]),
    );
  });
});
