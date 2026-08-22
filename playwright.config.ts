import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.E2E_PORT ?? "3100", 10);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://conformis:conformis@127.0.0.1:5432/conformis_e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
        url: `${baseURL}/de/analyses/new/framework`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          APP_ENV: "test",
          DEPLOYMENT_MODE: "local",
          DEPLOYMENT_PROFILE: "demo",
          DEFAULT_LOCALE: "de",
          CATALOGUE_DRIVER: "fixture",
          MODEL_CATALOGUE_DISCOVERY_DISABLED: "true",
          NEXT_PUBLIC_APP_URL: baseURL,
          DATABASE_URL: databaseUrl,
          DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED ?? databaseUrl,
          WORKER_REQUIRED: "false",
          TURNSTILE_ENFORCED: "false",
          ABUSE_HASH_SECRET: "e2e-only-abuse-hash-secret-at-least-thirty-two-characters",
        },
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
