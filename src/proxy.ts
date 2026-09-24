import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";

import { routing } from "@/i18n/routing";
import { auth, isAuthenticationConfigured } from "@/server/auth";
import { mergeRefreshedCookieHeader } from "@/server/auth/session-cookies";

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

function signInRedirect(request: NextRequest, authError?: string, next?: string) {
  const signIn = request.nextUrl.clone();
  signIn.pathname = `/${localeOf(request.nextUrl.pathname)}/sign-in`;
  signIn.search = "";
  if (authError) signIn.searchParams.set("auth_error", authError);
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

/**
 * Erzwingt eine bestehende Sitzung, bevor irgendein Anwendungsschritt erreichbar
 * ist. Die Analyse-Vorschau (Rahmenwerk, Policy, Umfang, Ergebnis) ist bewusst
 * kein anonymer Trichter: nur registrierte Kundinnen und Kunden kommen in die
 * App hinein. `auth.middleware()` wird pro Anfrage neu mit der erkannten
 * Sprache instanziiert, weil ihre Erkennung „bin ich schon die Anmeldefläche"
 * am konfigurierten `loginUrl` hängt — eine feste Instanz für `/de/sign-in`
 * würde `/en/sign-in` selbst wieder zur Anmeldung umleiten.
 */
async function requireSession(request: NextRequest) {
  const loginUrl = `/${localeOf(request.nextUrl.pathname)}/sign-in`;
  const gate = auth.middleware({ loginUrl });
  const originalTarget = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  let result: NextResponse;
  try {
    result = await gate(request);
  } catch {
    // Ein nicht erreichbarer Auth-Dienst darf keinen 500 auf jeder Seite der
    // Anwendung erzeugen; ohne bestätigte Sitzung geht es zurück zur Anmeldung.
    return signInRedirect(request, undefined, originalTarget);
  }

  if (!result.headers.get("location")) return result;

  // Die Bibliothek kopiert beim Umleiten nur die vorhandenen Suchparameter,
  // nicht den ursprünglichen Pfad. Ohne `next` wüsste die Anmeldefläche nach
  // erfolgreichem Login nicht, wohin sie zurückspringen soll.
  return copySetCookies(result, signInRedirect(request, undefined, originalTarget));
}

/**
 * Reicht die vom Auth-Gate aufgefrischten Sitzungscookies an dieselbe Anfrage
 * weiter.
 *
 * Das Gate hält den Sitzungsstand in einem kurzlebigen, signierten Cookie. Läuft
 * dessen Frist ab — nach wenigen Minuten ohne Klick —, holt es den Stand beim
 * Auth-Dienst nach und hängt das erneuerte Cookie als `Set-Cookie` an die
 * Antwort. Der Browser kennt es damit erst bei der *nächsten* Anfrage. Die Seite
 * dieser Anfrage sah bisher weiterhin das abgelaufene Cookie: Jede
 * Server-Komponente fragte den Auth-Dienst deshalb noch einmal selbst, und
 * sobald dessen Antwort ein aufgefrischtes Cookie enthielt, scheiterte das
 * Schreiben mitten im Rendern — Cookies lassen sich dort nicht setzen. Die
 * Sitzungsauflösung brach ab, und die Oberfläche zeigte nach einer Pause einen
 * abgemeldeten Zustand, obwohl die Sitzung gültig war und das Gate sie soeben
 * bestätigt hatte.
 *
 * `next-intl` kopiert die Header der übergebenen Anfrage in die weitergereichte
 * Anfrage; eine Kopie mit zusammengeführtem Cookie-Header genügt daher. Sie
 * bekommt bewusst keinen Rumpf: Sie dient allein der Lokalisierung, und ein hier
 * gelesener Rumpf fehlte der eigentlichen Anfrage.
 */
function withRefreshedSessionCookies(request: NextRequest, gate: NextResponse) {
  const refreshed = gate.headers.getSetCookie();
  if (refreshed.length === 0) return request;

  const merged = mergeRefreshedCookieHeader(request.headers.get("cookie") ?? "", refreshed);
  const headers = new Headers(request.headers);
  if (merged) headers.set("cookie", merged);
  else headers.delete("cookie");

  return new NextRequest(request.url, { headers, method: request.method });
}

/**
 * Hier stand eine Weiterleitung, die die Entwicklungsumgebung auf den in
 * `NEXT_PUBLIC_APP_URL` konfigurierten Origin zwang, damit host-gebundene
 * Session-Cookies nicht zwischen `localhost` und `127.0.0.1` zerfallen.
 *
 * Sie ist entfernt und gehört nicht zurück, weil sie ihre Aufgabe gar nicht
 * erfüllen konnte: Next.js kürzt im Dev-Modus den `Location`-Header einer
 * Middleware-Weiterleitung auf den reinen Pfad, sobald der Port gleich bleibt.
 * Der Hostname wurde also nie getauscht — die Weiterleitung landete wieder auf
 * `127.0.0.1` und lief endlos. Scheinbar funktioniert hat sie nur, weil sie
 * zusätzlich den Port aus der Konfiguration erzwang. Genau das machte die
 * Anwendung unbenutzbar, sobald `next dev` auf den nächsten freien Port
 * auswich (belegter Port 3000 durch ein zweites Projekt): Jede Anfrage ging auf
 * einen Port, auf dem diese Anwendung nicht lief, die Anmeldung kam nie an und
 * endete wieder auf der Anmeldefläche.
 *
 * Lokal bleibt `localhost` der einzige brauchbare Hostname: Der Neon-Auth-Dienst
 * beantwortet eine Anmeldung von `127.0.0.1` mit 403, und welche Herkunft er
 * akzeptiert, steht in der Neon-Konsole, nicht in diesem Repository. Das ist
 * eine Unbequemlichkeit; eine Weiterleitung, die jeden Request auf einen toten
 * Port schickt, war ein Ausfall.
 */
export default async function proxy(request: NextRequest) {
  // Rücksprung aus Anmeldelink oder OAuth. Es wird bewusst nicht vorab auf einen
  // Challenge-Cookie geprüft: der wird ausschließlich im OAuth-Fluss gesetzt
  // (siehe `src/server/middleware/oauth.ts` der Bibliothek), ein Anmeldelink setzt
  // beim Anfordern gar keinen Cookie. Eine solche Vorabprüfung blockierte jeden
  // Anmeldelink mit der falschen Begründung, er sei im falschen Browser geöffnet
  // worden. Die Bibliothek entscheidet selbst, ob der Verifier trägt.
  if (request.nextUrl.searchParams.has(verifierParameter)) {
    return completeAuthCallback(request);
  }

  const pathname = request.nextUrl.pathname;
  // Anmeldung, Registrierung, Passwort-Wiederherstellung sowie die rechtlichen
  // Seiten müssen ohne bestehende Sitzung erreichbar sein — die Registrierung
  // verlinkt vor Kontoerstellung auf Nutzungsbedingungen und Datenschutz.
  const publicAuthPages = new Set([
    "sign-in",
    "sign-up",
    "forgot-password",
    "reset-password",
    "terms",
    "privacy",
  ]);
  const [, , secondSegment] = pathname.split("/");
  const isPublicAuthPage = publicAuthPages.has(secondSegment ?? "");

  // Derselbe Entwicklungs-Umgehungspfad wie `requireAuthenticatedSessionUser`
  // (siehe `src/server/auth/session-user.ts`): lokal ohne konfigurierten
  // Auth-Anbieter arbeiten können, ohne die Prüfung in Produktion aufzuweichen.
  const isLocalAuthBypassEnabled =
    process.env.NODE_ENV !== "production" && process.env.LOCAL_AUTH_BYPASS === "true";

  if (isAuthenticationConfigured && !isPublicAuthPage && !isLocalAuthBypassEnabled) {
    const sessionCheck = await requireSession(request);
    if (sessionCheck.headers.get("location")) return sessionCheck;
    const authenticatedRequest = withRefreshedSessionCookies(request, sessionCheck);
    return copySetCookies(sessionCheck, await handleInternationalization(authenticatedRequest));
  }

  return handleInternationalization(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.well-known/workflow/|.*\\..*).*)",
};
