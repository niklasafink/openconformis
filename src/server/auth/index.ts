import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

export const isAuthenticationConfigured = Boolean(
  process.env.NEON_AUTH_BASE_URL &&
  process.env.NEON_AUTH_COOKIE_SECRET &&
  process.env.NEON_AUTH_COOKIE_SECRET.length >= 32,
);

const disabledAuthBaseUrl = "https://authentication-disabled.invalid";
const disabledCookieSecret = "authentication-disabled-cookie-secret-for-builds";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? disabledAuthBaseUrl,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET ?? disabledCookieSecret,
    sessionDataTtl: 300,
    sameSite: "lax",
  },
  logLevel: process.env.NODE_ENV === "test" ? "silent" : "warn",
});
