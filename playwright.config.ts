import { defineConfig, devices } from "@playwright/test";

const gatedPort = Number.parseInt(process.env.E2E_PORT ?? "3100", 10);
const bypassPort = Number.parseInt(process.env.E2E_BYPASS_PORT ?? "3101", 10);
const gatedBaseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${gatedPort}`;
const bypassBaseURL =
  process.env.E2E_BYPASS_BASE_URL ?? process.env.E2E_BASE_URL ?? `http://127.0.0.1:${bypassPort}`;
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://conformis:conformis@127.0.0.1:5432/conformis_e2e";

const sharedServerEnv = {
  APP_ENV: "test",
  DEPLOYMENT_MODE: "local",
  DEPLOYMENT_PROFILE: "demo",
  DEFAULT_LOCALE: "de",
  CATALOGUE_DRIVER: "fixture",
  MODEL_CATALOGUE_DISCOVERY_DISABLED: "true",
  DATABASE_URL: databaseUrl,
  DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED ?? databaseUrl,
  TURNSTILE_ENFORCED: "false",
  ABUSE_HASH_SECRET: "e2e-only-abuse-hash-secret-at-least-thirty-two-characters",
};

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
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Zwei Server statt einem: `authentication.spec.ts` prüft, dass `src/proxy.ts`
  // ohne Sitzung auf die Anmeldung umleitet — das setzt `isAuthenticationConfigured`
  // voraus. Ohne dediziertes Neon-Auth-Testprojekt (siehe Rückfrage an den Nutzer)
  // bekommt dieser Server nur eine syntaktisch gültige, nicht erreichbare
  // `NEON_AUTH_BASE_URL`; ein scheiternder Sitzungsabgleich landet laut
  // `requireSession`'s catch-Zweig ohnehin auf der Anmeldefläche. Die übrigen
  // Tests (`anonymous-analysis.spec.ts`) brauchen dagegen eine echte Sitzung, um
  // den Workflow zu erreichen — dafür läuft ein zweiter Server mit
  // `LOCAL_AUTH_BYPASS=true`. Ein einzelner Server könnte nicht beides zugleich:
  // die Umgehung ist serverweit, nicht pro Request.
  webServer: process.env.E2E_EXTERNAL_SERVER
    ? undefined
    : [
        {
          command: `pnpm dev --hostname 127.0.0.1 --port ${gatedPort}`,
          url: `${gatedBaseURL}/de/sign-in`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...sharedServerEnv,
            NEXT_PUBLIC_APP_URL: gatedBaseURL,
            LOCAL_AUTH_BYPASS: "false",
            NEON_AUTH_BASE_URL: "https://neon-auth-gating-check.invalid",
            NEON_AUTH_COOKIE_SECRET: "e2e-gating-check-cookie-secret-32-characters-min",
          },
        },
        {
          command: `pnpm dev --hostname 127.0.0.1 --port ${bypassPort}`,
          url: `${bypassBaseURL}/de/analyses/new/framework`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...sharedServerEnv,
            NEXT_PUBLIC_APP_URL: bypassBaseURL,
            LOCAL_AUTH_BYPASS: "true",
            E2E_DIST_SUFFIX: "-bypass",
          },
        },
      ],
  projects: [
    {
      name: "chromium-gated",
      testMatch: /authentication\.spec\.ts$/u,
      use: { ...devices["Desktop Chrome"], baseURL: gatedBaseURL },
    },
    {
      name: "chromium-bypass",
      testMatch: /anonymous-analysis\.spec\.ts$/u,
      use: { ...devices["Desktop Chrome"], baseURL: bypassBaseURL },
    },
  ],
});
