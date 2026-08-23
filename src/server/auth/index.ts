import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

// Eine leer gesetzte Variable ist dasselbe wie eine fehlende. `??` fällt darauf
// nicht zurück, und ein leeres Cookie-Secret lässt `createNeonAuth` beim Laden
// des Moduls werfen — was jede Route der Anwendung mit 500 beantwortet, statt
// die Authentifizierung sauber als „nicht konfiguriert" zu behandeln.
function configuredValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const authBaseUrl = configuredValue(process.env.NEON_AUTH_BASE_URL);
const rawCookieSecret = configuredValue(process.env.NEON_AUTH_COOKIE_SECRET);
// Ein zu kurzes Secret lässt die Bibliothek ebenfalls werfen; auch das ist eine
// unvollständige Konfiguration und keine funktionierende Authentifizierung.
const authCookieSecret =
  rawCookieSecret && rawCookieSecret.length >= 32 ? rawCookieSecret : undefined;

export const isAuthenticationConfigured = Boolean(authBaseUrl && authCookieSecret);

const disabledAuthBaseUrl = "https://authentication-disabled.invalid";
const disabledCookieSecret = "authentication-disabled-cookie-secret-for-builds";

export const auth = createNeonAuth({
  baseUrl: authBaseUrl ?? disabledAuthBaseUrl,
  cookies: {
    secret: authCookieSecret ?? disabledCookieSecret,
    sessionDataTtl: 300,
    sameSite: "lax",
  },
  logLevel: process.env.NODE_ENV === "test" ? "silent" : "warn",
});
