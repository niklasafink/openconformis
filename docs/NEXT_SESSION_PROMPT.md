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
4. Prüfungsumfang bestätigen
5. Registrieren
6. Eigenen API-Schlüssel hinterlegen
7. Analyse startet, läuft durch, **Ergebnis-Screen erscheint mit echten Bewertungen
   und Belegstellen**
8. Ergebnis nach Excel exportieren
9. Danach eine **zweite** Analyse mit derselben Policy starten — auch die muss
   durchlaufen

Fertig ist es, wenn du diesen Weg zweimal hintereinander vollständig durchgespielt
hast, ohne dass eine Fehlermeldung erscheint.

## Wie du vorgehen sollst

Rate nicht. Reproduziere jeden Fehler, bevor du ihn behebst, und weise nach dem
Beheben nach, dass er weg ist. Die Fehler in diesem Projekt lagen bisher fast nie
dort, wo die Meldung hinzeigte.

Nützliche Werkzeuge, die sich bewährt haben:

- Die Datenbank direkt abfragen (`analyses`, `analysis_model_invocations`,
  `analysis_requirement_results`) — dort steht `failure_code` und `failure_detail`.
- Den Dev-Server im Hintergrund mit `nohup ... & disown` starten und in eine
  Logdatei schreiben; sonst stirbt er mit deinem Kommando und der Lauf bleibt als
  Zombie stehen.
- Playwright gegen den laufenden Server:
  `E2E_EXTERNAL_SERVER=1 E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test <datei>`
- Nach jedem Modellaufruf-Fehler die Anfrage einmal direkt gegen den Anbieter
  nachstellen. Die echte Antwort war mehrfach etwas völlig anderes als der
  gespeicherte Code.

Nach jedem behobenen Fehler: `pnpm quality`, dann committen und pushen. Arbeite auf
`main`, kleine Commits, eine Ursache pro Commit. Die Commit-Nachricht soll die
Ursache erklären, nicht nur das Symptom.

## Ausgangslage

Der Arbeitsbaum enthält einen großen, **noch nicht committeten** Umbau: die
Anwendung läuft jetzt ausschließlich mit dem eigenen Schlüssel des Nutzers
(BYOK-only). Gesponserte Läufe, das Kontingent pro Konto, der Betreiber-Schlüssel
und die Turnstile-Prüfung sind entfernt; Migration `0043_byok_only` räumt die
zugehörigen Tabellen und Spalten ab. Prüfe diesen Umbau mit, er ist noch nirgends
end-to-end erprobt.

Beim Start gerade grün: `typecheck`, `lint`, 149 Unit-Tests. Das sagt allerdings
wenig — die Suite war schon mehrfach vollständig grün, während die Anwendung für
einen Nutzer unbenutzbar war.

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

Der vollständige Verlauf steht in `CHANGELOG.md` unter „Unreleased" und in
`docs/BACKEND_AUDIT.md`.

## Zwei Dinge, die du wissen musst

**Safari und Firefox funktionieren lokal über `http` nicht.** Neon Auth setzt
`__Secure-`-Cookies, die diese Browser über unverschlüsseltes HTTP verwerfen. Die
Registrierung sieht erfolgreich aus, es existiert aber keine Sitzung. Teste in
Chromium, oder nutze `pnpm dev:https` (siehe README).

**Ein bekannter offener Punkt, den ich entscheiden muss, nicht du:** Das Schema
verlangt für den Status „nicht erfüllt" eine als `contradicts` markierte
Belegstelle. Beim häufigsten Fall — die Policy schweigt zum Thema — gibt es die
nicht, also wählt das Modell „Keine Einschätzung möglich". Im letzten
erfolgreichen Lauf standen dadurch 7 von 10 Anforderungen ohne Verdikt. Ändere
diese Regel nicht von dir aus; sag mir am Ende, ob du sie für das Hauptproblem der
Ergebnisqualität hältst.

## Am Ende

Sag mir in einfachen Worten:

- ob der Weg jetzt zweimal hintereinander sauber durchläuft
- was du behoben hast, ohne Fachbegriffe
- was noch kaputt oder ungeprüft ist und warum
- was ich selbst tun muss

Behaupte nicht, etwas funktioniere, wenn du es nicht selbst durchgespielt hast.
