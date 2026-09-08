# Prompt für die nächste Sitzung

Alles unterhalb der Linie in ein neues Claude-Code-Fenster kopieren.

---

Arbeite in diesem Repository, bis ein Nutzer die Anwendung von Anfang bis Ende
ohne Fehler durchlaufen kann. Ich bin kein Entwickler und kann dir nicht helfen,
etwas einzugrenzen — triff alle technischen Entscheidungen selbst und frage mich
nur, wenn es ohne meine Angabe wirklich nicht weitergeht (etwa ein Zugangsschlüssel,
den nur ich beschaffen kann).

## Das Ziel

Der vollständige Weg muss funktionieren, mehrfach hintereinander, mit einem frisch
angelegten Konto:

1. `http://localhost:3000` öffnen
2. Rahmenwerk DORA wählen
3. Beispiel-Policy wählen
4. Prüfungsumfang bestätigen (alle 10 Anforderungen, nicht nur eine)
5. Registrieren
6. Eigenen API-Schlüssel hinterlegen
7. Analyse startet, läuft durch, **Ergebnis-Screen erscheint mit echten Bewertungen
   und Belegstellen**
8. Ergebnis nach Excel exportieren
9. Danach eine **zweite** Analyse mit derselben Policy starten — auch die muss
   durchlaufen

Fertig ist es, wenn du diesen Weg zweimal hintereinander vollständig durchgespielt
hast, ohne dass eine Fehlermeldung erscheint.

**Stand jetzt: Schritte 1–7 sind mit einer einzigen Anforderung (Art. 5 Abs. 2
DORA) einmal real durchgespielt und bestätigt — siehe unten. Der volle Umfang
(alle 10 Anforderungen, Export, zweiter Lauf) ist noch offen.**

## Wie du vorgehen sollst

Rate nicht. Reproduziere jeden Fehler, bevor du ihn behebst, und weise nach dem
Beheben nach, dass er weg ist. Die Fehler in diesem Projekt lagen bisher fast nie
dort, wo die Meldung hinzeigte.

Nützliche Werkzeuge, die sich bewährt haben:

- Die Datenbank direkt abfragen (`analyses`, `analysis_model_invocations`,
  `analysis_requirement_results`) — dort steht `failure_code` und `failure_detail`,
  und dort siehst du zuverlässig, ob ein Lauf wirklich `completed` erreicht hat,
  auch wenn die UI-Automatisierung das Ende verpasst (siehe Fußnote unten).
- Den Dev-Server im Hintergrund mit `nohup ... & disown` starten und in eine
  Logdatei schreiben; sonst stirbt er mit deinem Kommando und der Lauf bleibt als
  Zombie stehen. **Vor dem Start prüfen, ob schon einer läuft:**
  `curl -s localhost:3000/api/health` — Next.js lässt pro Projektverzeichnis nur
  einen `next dev` gleichzeitig zu und bricht sonst mit einer Fehlermeldung ab.
- Playwright gegen den laufenden Server:
  `E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test <datei>`
- Nach jedem Modellaufruf-Fehler die Anfrage einmal direkt gegen den Anbieter
  nachstellen. Die echte Antwort war mehrfach etwas völlig anderes als der
  gespeicherte Code.
- **Einen echten API-Schlüssel nie selbst tippen oder in eine Datei schreiben.**
  Der Auto-Mode-Classifier blockiert das zuverlässig, egal über welches Werkzeug.
  `.env.local` enthält bereits `TEST_OPENROUTER_API_KEY` (nur für Testskripte,
  kein Produktionscode liest das). Skripte damit ausschließlich über
  `node --env-file-if-exists=.env.local dein-skript.mjs` starten und den Wert nur
  als `process.env.TEST_OPENROUTER_API_KEY` referenzieren — nie im Kommando oder
  im Skripttext selbst ausschreiben.

Nach jedem behobenen Fehler: `pnpm quality`, dann committen. Arbeite auf `main`,
kleine Commits, eine Ursache pro Commit. Die Commit-Nachricht soll die Ursache
erklären, nicht nur das Symptom. Der lokale `main` liegt aktuell vor
`origin/main` (mehrere unveröffentlichte Commits) — vor einem `push` erst fragen.

## Ausgangslage

Die Anwendung läuft jetzt ausschließlich mit dem eigenen Schlüssel des Nutzers
(BYOK-only, committet). Gesponserte Läufe, das Kontingent pro Konto, der
Betreiber-Schlüssel und die Turnstile-Prüfung sind entfernt; Migration
`0043_byok_only` hat die zugehörigen Tabellen und Spalten bereits auf der echten
Datenbank abgeräumt (ausgeführt, nicht nur geschrieben). Zusätzlich lief seither
eine UI-Migration auf shadcn/ui (Inter/EB Garamond) — Selektoren in eigenen
Skripten vor Gebrauch neu prüfen, CSS-Klassen wie `.preview-auth-card`,
`.scope-count`, `#preview-api-key`, `#analysis-model` waren zuletzt noch stabil.

Beim Start gerade grün: `typecheck`, `lint`, 150 Unit-Tests. Das sagt allerdings
wenig — die Suite war schon mehrfach vollständig grün, während die Anwendung für
einen Nutzer unbenutzbar war. Ein realer Lauf mit echtem Modellaufruf ist der
einzige verlässliche Nachweis.

## Was schon behoben ist — nicht erneut suchen

Diese Fehler sind gefunden, behoben und verifiziert. Wenn ein Symptom danach
aussieht, hat es eine andere Ursache:

- Fehlende Root-Route; `/`, `/de`, `/en` waren 404.
- Anmeldelink wurde vor jeder Prüfung abgewiesen (Challenge-Cookie gehört zu OAuth,
  nicht zum Anmeldelink).
- Callback umging die Lokalisierung und landete im 404, obwohl die Sitzung stand.
- Keine eigenständige Anmelde- und Registrierungsseite.
- Registrierung verschwieg, dass das Konto bereits existiert.
- Ein Datenbank-Trigger verhinderte, dass **überhaupt je ein Ergebnis** gespeichert
  wurde (`CASE` in PL/pgSQL löst beide Feldzugriffe beim Planen auf).
- Ein zweiter Trigger verhinderte, dass ein Lauf je `completed` erreichte
  (Aufbewahrungsfrist auf einer unveränderlichen Policy-Fassung).
- Abgeschnittene Modellantworten wurden als Schemafehler gemeldet statt als zu
  niedriges Token-Limit.
- Der Prompt verschwieg dem Modell Regeln, nach denen das Schema es bewertet.
- Hängende Anbieteraufrufe liefen 7 und 15 Minuten, obwohl 120 Sekunden gesetzt
  waren.
- Startfehler haben jetzt je einen erklärenden Satz statt einer generischen Meldung.
- **Neu diese Sitzung:** Der Modellkatalog-Abruf brach für alle Nutzer komplett ab,
  sobald OpenRouters Live-Liste auch nur ein Modell mit `context_length: 0` enthielt
  (`z.number().positive()` verwarf die gesamte Antwort statt nur den Eintrag). Ist
  real gegen die Live-API reproduziert und behoben, samt Regressionstest.
- **Neu diese Sitzung:** Die Fehlermeldung bei gescheiterten Läufen sprach noch vom
  „Gratislauf, der wieder freigegeben wurde" — Altlast aus der Zeit vor BYOK-only,
  behoben.

Der vollständige Verlauf steht in `CHANGELOG.md` unter „Unreleased" und in
`docs/BACKEND_AUDIT.md`.

## Der reale Lauf, den ich schon gemacht habe

Kompletter Weg 1–7 mit **einer** Anforderung (Art. 5 Abs. 2 DORA, um Kosten klein
zu halten), echtem Konto (Passwort-Registrierung, keine E-Mail-Bestätigung nötig —
`startAnalysis` verlangt nur `requireAuthenticatedSessionUser`, nicht die
verifizierte Variante), echtem OpenRouter-Schlüssel, echtem Modellaufruf:

- Analyse-ID `ac35c4e4-0120-40ed-afde-9d509fefe364`, Status `completed` nach 54s.
- Modell (automatisch von der Sortierung gewählt, nicht fest verdrahtet):
  `anthracite-org/magnum-v4-72b` über OpenRouter, Route
  `openrouter-global-no-zdr-v1`.
- Bewertung + unabhängige Verifikation beide `succeeded`; die Verifikation hat die
  vorgeschlagene Bewertung **zu Recht abgelehnt** (Leitungsorgan-Überwachung nicht
  belegt) → Endstatus „Keine Einschätzung möglich" mit 4 echten Belegstellen und
  ausformulierter Begründung. Das ist die Anwendung, die wie vorgesehen
  funktioniert, kein Fehler.
- BYOK-Credential nach Abschluss zuverlässig gelöscht (in der DB verifiziert, nicht
  nur angenommen).
- Gesamtkosten: ca. 1,3 US-Cent (13446 Mikro-Einheiten über zwei Aufrufe).

Das war ein Wegwerf-Playwright-Skript, das ich wieder entfernt habe (nicht Teil des
Produkts). Baue bei Bedarf ein neues nach demselben Muster: Formular-Aktionen über
Rollen/Texte ansteuern, nicht über generierte IDs.

**Bekannte Falle beim Nachbauen:** Ein Skript, das auf `.analysis-run-status` pollt,
sieht das Ende nie zuverlässig — sobald der Lauf `completed` ist, rendert die Seite
statt der Fortschrittsansicht das Ergebnis-Widget, und dieses Element existiert dann
nicht mehr. Auf das **Verschwinden** der Fortschrittsansicht warten, oder direkt in
der Datenbank auf `status = 'completed'` pollen.

## Zwei Dinge, die du wissen musst

**Safari und Firefox funktionieren lokal über `http` nicht.** Neon Auth setzt
`__Secure-`-Cookies, die diese Browser über unverschlüsseltes HTTP verwerfen. Die
Registrierung sieht erfolgreich aus, es existiert aber keine Sitzung. Teste in
Chromium, oder nutze `pnpm dev:https` (siehe README).

**Dieses OpenRouter-Konto hat keine EU-Region freigeschaltet.** Ohne
`OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` in `.env.local` (bereits
gesetzt, nicht entfernen) schlägt jeder Aufruf mit `HTTP 403: Regional routing
not enabled for this account` fehl, weil der Code sonst auf
`OPENROUTER_EU_BASE_URL` zurückfällt. Das ist eine Kontobeschränkung, kein
Produktfehler — die Anwendung erzwingt bewusst keine EU-Route mehr (siehe
`docs/DECISIONS.md` D-025 und den Commit „stop enforcing EU routing").

**Ein bekannter offener Punkt, den ich entscheiden muss, nicht du:** Das Schema
verlangt für den Status „nicht erfüllt" eine als `contradicts` markierte
Belegstelle. Beim häufigsten Fall — die Policy schweigt zum Thema — gibt es die
nicht, also wählt das Modell „Keine Einschätzung möglich". Im echten Lauf oben
war das Ergebnis allerdings inhaltlich richtig (Verifikation hat eine Lücke
korrekt erkannt), nicht bloß ein Artefakt dieser Regel. Ändere die Regel nicht von
dir aus; sag mir am Ende, ob sie beim vollen 10-Anforderungen-Lauf trotzdem das
Hauptproblem der Ergebnisqualität ist.

## Am Ende

Sag mir in einfachen Worten:

- ob der volle Weg (alle 10 Anforderungen, Export, zweiter Lauf) jetzt zweimal
  hintereinander sauber durchläuft
- was du behoben hast, ohne Fachbegriffe
- was noch kaputt oder ungeprüft ist und warum
- was ich selbst tun muss

Behaupte nicht, etwas funktioniere, wenn du es nicht selbst durchgespielt hast.
