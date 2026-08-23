import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { routing } from "@/i18n/routing";
import { auth } from "@/server/auth";

const handleInternationalization = createMiddleware(routing);
const verifierParameter = "neon_auth_session_verifier";

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

/**
 * Hält die Entwicklungsumgebung auf einem kanonischen Origin, damit host-gebundene
 * Session-Cookies nicht zwischen `localhost` und `127.0.0.1` verloren gehen.
 *
 * Der Vergleich läuft über den tatsächlichen `Host`-Header, nicht über
 * `request.nextUrl.origin`: Next.js normalisiert `nextUrl` im Dev-Modus auf
 * `localhost`, sodass eine auf `127.0.0.1` konfigurierte App-URL nie übereinstimmt
 * und die Weiterleitung auf dieselbe Adresse zeigt — eine Endlosschleife, die
 * jeden Request der Anwendung trifft.
 */
function canonicalDevelopmentOriginRedirect(request: NextRequest) {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NODE_ENV === "production" || !configuredAppUrl) return null;

  let configuredOrigin: URL;
  try {
    configuredOrigin = new URL(configuredAppUrl);
  } catch {
    return null;
  }

  const requestHost = request.headers.get("host");
  if (!requestHost || requestHost === configuredOrigin.host) return null;

  const target = request.nextUrl.clone();
  target.protocol = configuredOrigin.protocol;
  target.host = configuredOrigin.host;

  // Letzte Sicherung gegen eine Schleife: eine Weiterleitung auf die angefragte
  // Adresse selbst bringt nichts und wiederholt sich endlos.
  if (target.toString() === request.nextUrl.toString()) return null;

  return NextResponse.redirect(target);
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

  let authResponse: NextResponse | undefined;
  try {
    authResponse = await handleNeonAuthCallback(request);
  } catch {
    // Ein nicht erreichbarer Auth-Dienst darf keinen 500 auf dem Rücksprungpfad
    // erzeugen. Der Nutzer landet auf der Anmeldefläche und kann es erneut
    // versuchen, statt auf einer Fehlerseite zu stehen.
    return signInRedirect(request, "magic_link_invalid", `${target.pathname}${target.search}`);
  }
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
  const canonicalRedirect = canonicalDevelopmentOriginRedirect(request);
  if (canonicalRedirect) return canonicalRedirect;

  // Rücksprung aus Anmeldelink oder OAuth. Es wird bewusst nicht vorab auf einen
  // Challenge-Cookie geprüft: der wird ausschließlich im OAuth-Fluss gesetzt
  // (siehe `src/server/middleware/oauth.ts` der Bibliothek), ein Anmeldelink setzt
  // beim Anfordern gar keinen Cookie. Eine solche Vorabprüfung blockierte jeden
  // Anmeldelink mit der falschen Begründung, er sei im falschen Browser geöffnet
  // worden. Die Bibliothek entscheidet selbst, ob der Verifier trägt.
  if (request.nextUrl.searchParams.has(verifierParameter)) {
    return completeAuthCallback(request);
  }

  return handleInternationalization(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.well-known/workflow/|.*\\..*).*)",
};
