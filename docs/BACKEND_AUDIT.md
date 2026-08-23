# Backend-Audit — Authentifizierung, Datenbank, Datensicherheit

Stand: 2026-08-23. Prüfung ohne Änderung an Anwendungscode, Datenbank oder Konfiguration.

> **Nachtrag 2026-08-23:** Die Befunde AUTH-001 bis AUTH-008 und TEST-001 wurden auf
> dem Branch `fix/auth-flow` behoben und verifiziert; der Status je Befund steht
> unten. CONFIG-001 bleibt offen, weil es eine Konfigurations- und keine
> Codefrage ist. Die unter „Nicht geprüft" genannten Bereiche sind unverändert
> ungeprüft — die Gesamtentscheidung bleibt deshalb bestehen, bis sie geprüft sind.

## Entscheidung

**Nicht freigabefähig.**

Der Anmeldeprozess ist nicht funktionsfähig, und zwar nicht durch eine Fehlkonfiguration,
sondern durch drei zusammenwirkende Defekte im Routing. Beide Fehlerpfade des Magic Links
enden reproduzierbar auf einer 404-Seite; die dafür gebaute Fehlerbehandlung ist im Code
vorhanden, aber unerreichbar. Zusätzlich existiert keine Registrierungs- oder Anmeldefläche
außerhalb eines Modals im Ergebnis-Vorschauscreen.

Datenbankschicht und Mandantentrennung sind demgegenüber in gutem Zustand. Die Befunde
konzentrieren sich fast vollständig auf Auth und Routing.

## Geprüfter Umfang

Geprüft: `src/proxy.ts`, `src/server/auth/*`, `src/app/api/auth/[...all]/route.ts`,
`src/components/results/preview-gate.tsx`, `src/app/[locale]/analyses/new/results/page.tsx`,
`src/server/drafts/framework-selection.ts`, `src/server/analyses/*`,
`src/server/db/schema/analyses.ts`, `next.config.ts`, Routen unter `src/app/api/`,
sowie die Neon-Auth-Bibliothek unter `node_modules/@neondatabase/auth/dist/`.

Ausgeführt: `pnpm typecheck` (sauber), `pnpm test` (27 Dateien, 90 Tests grün),
`pnpm db:check` (konsistent, 37 Migrationen), sowie HTTP-Requests gegen den laufenden
Dev-Server auf `127.0.0.1:3000`.

**Nicht geprüft** — bewusst offen, nicht als bestanden zu werten: Upload/Parsing/OCR-Grenzen,
BYOK-Kryptografie im Detail, Workflow-Idempotenz und Retry-Verhalten, Chat und Streaming,
Retention- und Löschpfade, Rate-Limit-Wirksamkeit unter Last, Lieferkette und Lizenzen.

---

## Befunde

### AUTH-001 · kritisch · Es existiert keine Root-Route — **behoben**

`src/app/[locale]/` enthält `administration/`, `analyses/`, `chat/` und `layout.tsx` —
aber **keine `page.tsx`**. Es gibt auch keine `src/app/page.tsx`.

Nachweis:

```
/     → 307 → /de → 404
/de   → 404
/en   → 404
/de/analyses/new/framework → 200
```

Auswirkung: `src/proxy.ts:11` konfiguriert `auth.middleware({ loginUrl: "/" })`. Jede
Weiterleitung der Neon-Auth-Middleware auf den Login zeigt damit auf eine 404-Seite.
Die Anwendung hat zudem keinen Einstiegspunkt — wer die Domain aufruft, landet im Nichts.

Abhilfe: Root-Page anlegen (Einstieg oder Redirect auf `/analyses/new/framework`) und
`loginUrl` auf eine reale, lokalisierte Anmeldefläche zeigen lassen (siehe AUTH-004).

### AUTH-002 · kritisch · Der Magic-Link-Callback umgeht die Lokalisierungs-Middleware — **behoben**

`src/proxy.ts:34` gibt im Callback-Zweig `handleNeonAuthCallback(request)` zurück und
führt `handleInternationalization` in diesem Pfad **nie** aus:

```ts
if (request.nextUrl.searchParams.has("neon_auth_session_verifier")) {
  ...
  return handleNeonAuthCallback(request);   // next-intl wird übersprungen
}
return handleInternationalization(request);
```

`neonAuthMiddleware` gibt bei `action: "allow"` ein `NextResponse.next()` mit angehängten
`Set-Cookie`-Headern zurück (`node_modules/@neondatabase/auth/dist/next/server/index.mjs`,
Zweig `case "allow"`). Der Request läuft also ohne next-intl-Rewrite weiter in den
App Router. Bei `localePrefix: "always"` und ausschließlich `[locale]`-Routen bedeutet
das für jeden Pfad ohne Locale-Präfix einen 404.

Nachweis — Callback auf `/` mit gültig aussehendem Challenge-Cookie:

```
GET /?draft=x&neon_auth_session_verifier=testtoken
Cookie: __Secure-neon-auth.session_challenge=dummy
→ 404
```

Besonders tückisch: Die Session-Cookies werden auf der 404-Antwort mitgesetzt. Der Nutzer
kann also angemeldet sein und trotzdem eine Fehlerseite sehen — das erklärt den
wechselnden, scheinbar zufälligen Charakter der Symptome.

### AUTH-003 · kritisch · Beide Magic-Link-Fehlerpfade enden im 404, die Fehleranzeige ist unerreichbar — **behoben**

`src/proxy.ts:28–33` behandelt den Fall eines fehlenden Challenge-Cookies korrekt und
leitet mit `auth_error=magic_link_browser_mismatch` zurück. Genau dieser Fall tritt ein,
wenn der Link aus einem Mail-Client oder einem anderen Browser geöffnet wird.

Die Zielseite ruft dann aber `getBoundActiveDraft(draft)` auf
(`src/app/[locale]/analyses/new/results/page.tsx:31`), und das liest den
`conformis_draft_binding`-Cookie — der im fremden Browser ebenso fehlt. Ergebnis:
`notFound()` (Zeile 35), bevor `PreviewGate` und damit die `authCallbackError`-Anzeige
überhaupt gerendert wird.

Nachweis:

```
GET /de/analyses/new/results?draft=…&neon_auth_session_verifier=testtoken
→ 307 → …?auth_error=magic_link_browser_mismatch
GET /de/analyses/new/results?draft=…&auth_error=magic_link_browser_mismatch
→ 404
```

Die gesamte Fehlerbehandlung in `preview-gate.tsx` (`authCallbackError`, `authError`,
`authDialogOpen`) ist damit toter Code für den einzigen Fall, für den sie gebaut wurde.

Abhilfe: Der Wiedereinstieg nach fehlgeschlagenem Magic Link darf nicht von einem
Draft-Binding-Cookie abhängen. Er braucht eine eigene, cookie-unabhängige Fläche mit
der Möglichkeit, den Link erneut anzufordern.

### AUTH-004 · hoch · Es gibt keine Registrierungs- oder Anmeldefläche — **behoben**

Die einzige Auth-Oberfläche der Anwendung ist ein Modal in
`src/components/results/preview-gate.tsx`. Es gibt keine Route für Anmeldung,
Registrierung, Passwort-Zurücksetzen, E-Mail-Verifikation oder erneuten Link-Versand.

Folgen:

- Die Registrierung ist nur erreichbar, wenn man vorher einen kompletten Analyse-Draft
  angelegt hat. Das ist der Grund, warum sich der Vorgang nicht wie eine normale
  Anmeldung anfühlt.
- Ein Nutzer mit abgelaufener Sitzung hat keinen Ort, an den er gehen kann.
- Ein Nutzer mit unbestätigter E-Mail bekommt keine Fläche, auf der er das erfährt oder
  ändern kann — obwohl `VerifiedEmailRequiredError` serverseitig existiert
  (`src/server/auth/session-user.ts`).
- `loginUrl: "/"` hat kein sinnvolles Ziel, weil es keines gibt (siehe AUTH-001).

### AUTH-005 · hoch · Nach erfolgreicher Anmeldung bleibt das Ergebnis unscharf — **behoben**

`preview-gate.tsx` übergibt `lockedPreview` an `AnalysisResultsWorkspace`
**unabhängig vom Session-Zustand**. Der einzige Weg aus der Unschärfe ist
`router.replace(/${locale}/analyses/${analysisId})` nach erfolgreichem Start.

Schlägt der Start aus irgendeinem Grund fehl, setzt der Catch-Zweig nur
`setStartError(true)`. Die Oberfläche zeigt dann weiterhin die verschwommene Vorschau
mit „Ergebnis freischalten"-Button plus einen kleinen Hinweistext. Der Nutzer ist
angemeldet, sieht aber unverändert die gesperrte Ansicht — exakt das berichtete Symptom.

Zusätzlich läuft die simulierte Fortschrittsanimation (3 × 650 ms) bei jedem Mount erneut,
also auch nach der Rückkehr vom Magic Link.

### AUTH-006 · hoch · Der Client behandelt 401 und 403 des Start-Endpoints nicht — **behoben**

`preview-gate.tsx` unterscheidet nur:

```ts
const requiresOwnKey =
  response.status === 402 ||
  payload.code === "SPONSORED_RUNS_DISABLED" ||
  payload.code === "SPONSORED_ROUTE_NOT_CONFIGURED" ||
  payload.code === "SPONSORED_MODEL_NOT_ALLOWED";
```

`src/app/api/analyses/start/route.ts` liefert aber auch `AUTHENTICATION_REQUIRED` (401)
und `VERIFIED_EMAIL_REQUIRED` (403). Beide fallen in den generischen `throw` und landen
in `setStartError(true)` — also in der Sackgasse aus AUTH-005, ohne dass dem Nutzer
gesagt wird, dass seine E-Mail unbestätigt ist oder die Sitzung fehlt.

### AUTH-007 · mittel · `MembershipRequiredError` wird in mehreren Routen nicht behandelt — **behoben**

`requireSessionPrincipal()` wirft `MembershipRequiredError`, wenn zum Nutzer keine
Mitgliedschaft existiert (`src/server/auth/session-principal.ts`). Die Organisation wird
erst beim Analysestart angelegt (`start-analysis.ts:271–288`); `ensureApplicationUser`
legt sie nicht an.

Ein angemeldeter Nutzer ohne abgeschlossenen Start hat also keine Mitgliedschaft. Routen,
die `requireSessionPrincipal` verwenden, aber `MembershipRequiredError` nicht fangen —
darunter `DELETE /api/analyses/[analysisId]` — antworten dann mit **500 statt 403**.
Die Admin- und Override-Routen fangen den Fehler korrekt ab.

### AUTH-008 · mittel · Das Callback-Ziel zerstört sich selbst — **behoben**

Der `callbackUrl` für die Anmeldung zeigt auf die Vorschauseite
(`results/page.tsx:37`). Nach erfolgreichem Claim setzt `start-analysis.ts:397` den Draft
auf `status: "claimed"`. `getBoundActiveDraft` filtert auf `status = "active"`
(`framework-selection.ts:47`) und liefert danach `null` → `notFound()`.

Damit wird der Anmelde-Rücksprungpunkt nach dem ersten erfolgreichen Start dauerhaft zu
einem 404. Betroffen: Reload, Zurück-Button, zweiter Klick auf den Magic Link, zweiter Tab.

### CONFIG-001 · hoch (nur lokal) · Sponsored-Runs sind lokal nicht konfiguriert — **offen**

`.env.local` setzt `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, `NEON_AUTH_JWKS_URL`, `NEON_BRANCH`, `NEXT_PUBLIC_APP_URL` —
aber weder `SPONSORED_RUNS_ENABLED` noch `AI_PROVIDER_ALLOWLIST` oder einen Blob-Token.

`readSponsoredRoute()` wirft deshalb sofort `SPONSORED_RUNS_DISABLED`. Selbst bei
vollständig repariertem Login endet der lokale Durchlauf im BYOK-Dialog. Das ist beim
Debuggen wichtig zu wissen, damit die Ursache nicht bei der Auth gesucht wird.

### TEST-001 · hoch · Genau die kaputten Pfade sind ungetestet — **behoben**

90 Tests sind grün, während der Anmeldeprozess nicht funktioniert. Der einzige
E2E-Test (`tests/e2e/anonymous-analysis.spec.ts`) endet bei
`"shows an interactive locked result before opening registration"` — also unmittelbar
**vor** dem defekten Bereich.

Es fehlen Tests für: Root-Route, Magic-Link-Callback mit und ohne Challenge-Cookie,
Session-Übernahme, unbestätigte E-Mail, Draft-Claim, Wiedereinstieg nach dem Claim und
Cross-Tenant-Zugriffe mit zwei getrennten Konten.

---

## Was in Ordnung ist

Diese Punkte wurden geprüft und geben keinen Anlass zu Änderungen:

- **Mandantentrennung bei Lesezugriffen.** `GET /api/analyses/[id]`, die Dokument- und
  die Export-Route scopen konsistent über `ownerUserId`. Kein IDOR gefunden.
- **Löschung.** `DELETE /api/analyses/[id]` übergibt zwar keine Nutzer-ID, aber
  `requestAnalysisDeletion` erzwingt `organizationId` **und** `ownerUserId` im Service
  unvermeidbar. Kein Befund.
- **Doppel-Claim-Schutz.** `uniqueIndex("analyses_source_draft_uidx")` auf
  `analyses.source_draft_id` plus Compare-and-Swap auf `anonymousDrafts.status` plus
  Advisory Lock. Zwei Konten können denselben Draft nicht übernehmen.
- **Fremdschlüssel und Kaskaden.** Kindtabellen von `analyses` stehen auf `cascade`,
  fachliche Referenzen auf `restrict`. Die Löschung läuft ohne FK-Verletzung durch.
- **Migrationen.** `drizzle-kit check` meldet Konsistenz über 37 Migrationen.
- **Security-Header.** CSP mit `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy`, HSTS in Produktion sind in `next.config.ts` gesetzt.
- **Typsicherheit.** `tsc --noEmit` läuft sauber durch.

---

## Behebungsreihenfolge

**Go-live-Blocker, in dieser Reihenfolge:**

1. **AUTH-001** — Root-Route anlegen. Voraussetzung für alles Weitere, weil jeder
   Fehlerpfad dorthin zeigt.
2. **AUTH-004** — Eigene, lokalisierte Anmelde- und Registrierungsroute. Danach kann
   `loginUrl` auf ein echtes Ziel zeigen.
3. **AUTH-002** — Im Callback-Zweig die Antwort der Auth-Middleware durch next-intl
   führen, statt es zu überspringen. Alternativ den Callback auf einen Pfad legen, der
   das Locale-Präfix bereits trägt und für den der Rewrite entbehrlich ist.
4. **AUTH-003** — Wiedereinstieg nach fehlgeschlagenem Magic Link cookie-unabhängig
   machen, mit „Link erneut senden".
5. **AUTH-005 / AUTH-006** — `lockedPreview` an den Session-Zustand koppeln und die
   Statuscodes 401/403 im Client eigenständig behandeln.
6. **AUTH-008** — Nach dem Claim auf die Analyse weiterleiten, statt eine Seite als
   Rücksprungziel zu benutzen, die sich selbst invalidiert.

**Danach:**

7. **AUTH-007** — `MembershipRequiredError` in allen Routen auf 403 abbilden.
8. **TEST-001** — E2E über den vollständigen Anmeldepfad, plus Cross-Tenant-Test mit
   zwei Konten. Ohne diese Tests wiederholt sich die Situation, dass eine grüne Suite
   eine kaputte Anwendung testiert.

**Verifikation:** Nach 1–6 muss ein echter Magic-Link-Durchlauf in zwei Varianten
funktionieren — Link im selben Browser geöffnet, und Link in einem anderen Browser
geöffnet. Beide dürfen an keiner Stelle einen 404 erzeugen, und der zweite muss in einer
verständlichen Wiederholungsaufforderung enden.

## Nicht bewiesen

Für folgende Bereiche liegt kein Nachweis vor, weder positiv noch negativ: Verhalten der
Neon-Auth-Middleware bei einem **echten** gültigen Verifier (geprüft wurde nur mit
Dummy-Token), Cookie-Verhalten unter HTTPS auf `open.conformisgrc.com`, OAuth-Rückläufe
von Google und Microsoft, sowie sämtliche unter „Nicht geprüft" genannten Bereiche.

---

## Nachtrag: Umsetzung (Branch `fix/auth-flow`)

| Befund     | Status  | Umsetzung                                                                                                                                                                                                         |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-001   | behoben | `src/app/[locale]/page.tsx` angelegt; leitet auf die Rahmenwerkauswahl weiter.                                                                                                                                    |
| AUTH-002   | behoben | `src/proxy.ts` übersetzt den Callback in eine eigene Weiterleitung, übernimmt die Session-Cookies und entfernt den einmaligen Verifier. Der Folge-Request durchläuft next-intl regulär.                           |
| AUTH-003   | behoben | Fehlerpfade zeigen auf `/{locale}/sign-in` statt auf die cookie-abhängige Vorschauseite; das ursprüngliche Ziel bleibt in `next` erhalten.                                                                        |
| AUTH-004   | behoben | `src/app/[locale]/sign-in/page.tsx` plus `src/components/auth/auth-form.tsx`; Dialog und Seite teilen dieselbe Implementierung.                                                                                   |
| AUTH-005   | behoben | `lockedPreview` nur noch ohne Sitzung. Angemeldet erscheint ein Start- oder Fehlerzustand mit Handlungsoption. Die Vorschauwerte werden bewusst **nicht** freigeschaltet, weil es Demo-Stati ohne Bewertung sind. |
| AUTH-006   | behoben | 401 und 403 werden getrennt behandelt und benannt.                                                                                                                                                                |
| AUTH-007   | behoben | `MEMBERSHIP_REQUIRED` → 403 in Analyse-Löschung und beiden Chat-Routen.                                                                                                                                           |
| AUTH-008   | behoben | `findOwnedAnalysisIdForDraft`; die Vorschauseite springt auf eine bereits gestartete Analyse.                                                                                                                     |
| TEST-001   | behoben | `tests/e2e/authentication.spec.ts` (5 Fälle) und `src/lib/safe-redirect.test.ts` (6 Fälle).                                                                                                                       |
| CONFIG-001 | offen   | Konfigurationsfrage, kein Codedefekt.                                                                                                                                                                             |

Zusätzlich: `safeInternalPath` validiert Rücksprungziele gegen Open Redirect; die
Analyse-Seite leitet bei abgelaufener Sitzung auf die Anmeldung statt auf 404.

**Verifikation:** `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm db:check`,
`pnpm build` sauber; 96 Unit-Tests und 11 E2E-Tests grün. Die zuvor
reproduzierten 404-Pfade wurden gegen den laufenden Server erneut geprüft und
liefern jetzt eine funktionierende Anmeldefläche mit benannter Ursache.

**Weiterhin nicht bewiesen:** der Durchlauf mit einem echten, gültigen Verifier.
Dafür ist ein Provider-Roundtrip nötig, der lokal nicht erzeugt werden kann. Die
Routing- und Fehlerpfade sind bewiesen, der erfolgreiche Sitzungsaufbau nicht.
