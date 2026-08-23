import createMiddleware from "next-intl/middleware";
import { NEON_AUTH_SESSION_CHALLENGE_COOKIE_NAME } from "@neondatabase/auth/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { routing } from "@/i18n/routing";
import { auth } from "@/server/auth";

const handleInternationalization = createMiddleware(routing);
const verifierParameter = "neon_auth_session_verifier";
const legacyNeonChallengeCookie = "__Secure-neon-auth.session_challange";

// Die Bibliothek leitet bei nicht herstellbarer Sitzung auf `loginUrl` um. Dieses
// Ziel muss eine real existierende, lokalisierte Route sein — sonst endet der
// Fehlerpfad im 404 und der Nutzer erfährt nie, was schiefgelaufen ist.
const handleNeonAuthCallback = auth.middleware({
  loginUrl: `/${routing.defaultLocale}/sign-in`,
});

function localeOf(pathname: string) {
  const [, firstSegment] = pathname.split("/");
  return routing.locales.find((locale) => locale === firstSegment) ?? routing.defaultLocale;
}

function signInRedirect(request: NextRequest, authError: string, next?: string) {
  const signIn = request.nextUrl.clone();
  signIn.pathname = `/${localeOf(request.nextUrl.pathname)}/sign-in`;
  signIn.search = "";
  signIn.searchParams.set("auth_error", authError);
  if (next) signIn.searchParams.set("next", next);
  return NextResponse.redirect(signIn);
}

function copySetCookies(source: Response, target: NextResponse) {
  for (const cookie of source.headers.getSetCookie()) {
    target.headers.append("set-cookie", cookie);
  }
  return target;
}

/**
 * Verarbeitet den Rücksprung aus Anmeldelink und OAuth.
 *
 * Die Neon-Auth-Middleware liefert im Erfolgsfall ein `NextResponse.next()` mit
 * angehängten Session-Cookies. Gäbe man das unverändert zurück, liefe der Request
 * an der Lokalisierungs-Middleware vorbei und träfe im App Router auf keine Route,
 * weil sämtliche Seiten unter `[locale]` liegen. Deshalb wird der Callback in eine
 * eigene Weiterleitung übersetzt: die Cookies werden übernommen, der einmalige
 * Verifier fällt aus der URL, und der Folge-Request durchläuft die Lokalisierung
 * ganz normal.
 */
async function completeAuthCallback(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.searchParams.delete(verifierParameter);

  const authResponse = await handleNeonAuthCallback(request);
  if (!authResponse) return NextResponse.redirect(target);

  if (authResponse.headers.get("location")) {
    // Die Sitzung konnte nicht hergestellt werden — abgelaufener oder bereits
    // eingelöster Link. Auf die Anmeldefläche statt auf `loginUrl`, und das
    // ursprüngliche Ziel für den zweiten Versuch mitnehmen.
    return copySetCookies(
      authResponse,
      signInRedirect(request, "magic_link_invalid", `${target.pathname}${target.search}`),
    );
  }

  return copySetCookies(authResponse, NextResponse.redirect(target));
}

export default async function proxy(request: NextRequest) {
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

  if (request.nextUrl.searchParams.has(verifierParameter)) {
    const hasChallenge =
      request.cookies.has(NEON_AUTH_SESSION_CHALLENGE_COOKIE_NAME) ||
      request.cookies.has(legacyNeonChallengeCookie);

    if (!hasChallenge) {
      // Der Link wurde in einem anderen Browserprofil geöffnet, typischerweise aus
      // einem Mail-Client. Das Ziel darf hier nicht die Vorschauseite sein: deren
      // Draft-Bindung hängt an einem Cookie, das in diesem Profil ebenfalls fehlt,
      // und die Seite bräche vor jeder Fehlermeldung mit 404 ab.
      return signInRedirect(request, "magic_link_browser_mismatch");
    }

    return completeAuthCallback(request);
  }

  return handleInternationalization(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.well-known/workflow/|.*\\..*).*)",
};
