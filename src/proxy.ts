import createMiddleware from "next-intl/middleware";
import { NEON_AUTH_SESSION_CHALLENGE_COOKIE_NAME } from "@neondatabase/auth/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { routing } from "@/i18n/routing";
import { auth } from "@/server/auth";

const handleInternationalization = createMiddleware(routing);
const handleNeonAuthCallback = auth.middleware({ loginUrl: "/" });
const legacyNeonChallengeCookie = "__Secure-neon-auth.session_challange";

export default function proxy(request: NextRequest) {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NODE_ENV !== "production" && configuredAppUrl) {
    const configuredOrigin = new URL(configuredAppUrl);
    if (request.nextUrl.origin !== configuredOrigin.origin) {
      const target = request.nextUrl.clone();
      target.protocol = configuredOrigin.protocol;
      target.host = configuredOrigin.host;
      return NextResponse.redirect(target);
    }
  }

  if (request.nextUrl.searchParams.has("neon_auth_session_verifier")) {
    const hasChallenge =
      request.cookies.has(NEON_AUTH_SESSION_CHALLENGE_COOKIE_NAME) ||
      request.cookies.has(legacyNeonChallengeCookie);
    if (!hasChallenge) {
      const target = request.nextUrl.clone();
      target.searchParams.delete("neon_auth_session_verifier");
      target.searchParams.set("auth_error", "magic_link_browser_mismatch");
      return NextResponse.redirect(target);
    }
    return handleNeonAuthCallback(request);
  }

  return handleInternationalization(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.well-known/workflow/|.*\\..*).*)",
};
