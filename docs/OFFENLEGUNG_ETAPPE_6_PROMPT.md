# Prompt: Offenlegungspflicht – Fortsetzung mit Etappe 6 bis 8

Alles unterhalb der Linie in ein neues Claude-Code-Fenster kopieren. Vorher die eine
offene Entscheidung unter „Entscheidungen, die schon gefallen sind“ ausfüllen.

---

Du setzt in diesem Repository den Bereich „Offenlegungspflicht“ fort. Der vollständige
Auftrag steht in `docs/OFFENLEGUNG_SESSION_PROMPT.md` und gilt unverändert. Lies ihn
zuerst ganz. Lies außerdem:

- `CLAUDE.md` und `DESIGN.md`,
- `docs/DECISIONS.md` ab D-029 (D-033 ist das Jev-Muster der Gap-Analyse, D-034 die
  Zahlenübernahme),
- `docs/JEV_ASSIST_ACCEPTANCE.md`,
- `docs/OFFENLEGUNG_FORTSETZUNG_PROMPT.md`, vor allem den Abschnitt „Arbeitsumgebung und
  Fallstricke“. Er gilt für diese Session unverändert.

Etappe 1–5 sind fertig, gepusht und in Produktion migriert (bis 0058). Checkpoint 2 ist
abgenommen. Deine Aufgabe sind **Etappe 6, 7 und 8** und danach **Checkpoint 3** mit
mir. Stell keinen neuen Gesamtplan auf. Zeig vor dem Code nur einen kurzen Plan für
Etappe 6–8 in Stichpunkten und leg dann los.

## Entscheidungen, die schon gefallen sind

- Alle Regeln aus der Fortsetzung zu Etappe 4 und 5 gelten weiter:
  - Prod-Migration mit `pnpm db:migrate` machst du selbst, **bevor** du Code pushst, der
    neue Tabellen liest. Migrationen bleiben additiv.
  - Kein Feature-Schalter für den Bereich.
  - Rollen stehen in `src/server/disclosure/actor.ts`.
  - Durchlaufen ohne Zwischenfragen. Anhalten nur bei echten Blockern und an
    Checkpoint 3.
- Das Layout ist abgenommen. Ändere es nicht: Feststellungsliste links, Dokument in der
  Mitte, Popover als Detail, Reiterzeile über dem Dokument, „Analyse stoppen“ oben
  rechts.
- **Abweichende Gliederung gbs Anlage 2.2** (derzeit 5 orange Feststellungen):
  `<<< EINE ZEILE STEHEN LASSEN >>>`
  - Behalten: alle 5 orange Feststellungen bleiben.
  - Reduzieren: nur das Betriebsergebnis bleibt orange. Personalaufwand und sonstige
    betriebliche Aufwendungen entfallen. Passe `scripts/disclosure-acceptance.ts` und
    die Unit-Tests an. Die gbs-Erwartung sinkt dann von 6 auf 4 orange.
- Die beiden echten Fehler aus Checkpoint 2 bleiben rot. Nimm sie als eigene Fälle in
  das Abnahmeskript auf:
  - gbs Tz 66 „um TEUR 113 auf TEUR 228“, richtig wären 115.
  - ICBC Anlagenspiegel „Zugang Summe 17.811,66“, richtig wären 171.811,66.

## Was aus Etappe 4 und 5 existiert

- **Schema**: `src/server/db/schema/disclosure.ts`, Migration 0057 mit Runs, Checks,
  Findings und `disclosure_model_invocations`. 0058 fügt den Schlüsselzweck
  `disclosure` hinzu.
- **Domäne** `src/domain/disclosure/checks/`:
  - `text.ts`, `tables.ts`, `posten.ts`, `facts.ts`, `comments.ts`, `findings.ts` und
    `run.ts`.
  - Zuordnung in `assignment.ts` mit `assignment-limits.ts`.
- **Server** `src/server/disclosure/`:
  - Lauf: `start-run.ts`, `execute-run.ts`, `assign-run.ts`, `cancel-run.ts`.
  - Lesen und Umgebung: `read-run.ts`, `model-route.ts`, `engine-document.ts`,
    `disclosure-http.ts`.
  - DB-Test: `disclosure-run.db.test.ts`.
- **Workflow**: `src/workflows/disclosure-plausibility.ts`.
- **Routen**:
  - `POST /api/disclosure/cases/[caseId]/runs`
  - `POST /api/disclosure/runs/[runId]/cancel`
- **Oberfläche**: `run-controls.tsx`, `stop-run-button.tsx` und
  `plausibility-workspace.tsx`.
- **Abnahme**: `scripts/disclosure-acceptance.ts` prüft die 26 Fälle gegen die lokale
  Datenbank.

## Etappe 6: Jev-Einordnung (eigener Commit)

Gilt wie im Auftrag §5 (Einordnung durch Jev) und §11. Konkret:

- Schalter `DISCLOSURE_JEV_ASSIST=on|off`, Default `on`. Er wird je Lauf in
  `disclosure_runs.jev_assist` eingefroren. Ohne gespeicherten TypeSafe-Schlüssel ist
  der eingefrorene Wert `off`.
- **Eigene additive Migration** und **eigener Commit**, damit `git revert` eine
  funktionierende Anwendung hinterlässt. Kein anderer Pfad darf TypeSafe voraussetzen.
  `scripts/check-byok-config.ts` verlangt ihn nicht.
- Übernimm das Muster der Gap-Analyse:
  - `src/server/review/jev-client.ts` und `src/server/worker/jev-assist-client.ts`,
  - `src/server/ai/typesafe.ts` und `jev-throttle.ts`,
  - `src/server/analyses/jev-assist-start.ts`.
- Kurzlebiger Schlüssel mit Zweck `disclosure_assist`. Er wird im Finalize, im
  Fail-Pfad und im Cancel-Pfad gelöscht, zusammen mit dem Modellschlüssel.
  `cancel-run.ts` muss beide löschen.
- **Ablauf**:
  - Jev ordnet zuerst ein.
  - Fälle unter der Konfidenzschwelle gehen an das Nutzermodell.
  - Bei `off` ordnet das Nutzermodell alles ein, wie heute.
  - Die Ausgabe enthält nur IDs und wird nachgerechnet. `assignment_source` ist dann
    `jev`.
  - Der Replay läuft über `disclosure_model_invocations`, Anbieter `jev`.
- In der Oberfläche steht eine Zeile in den Laufsteuerungen: „Einordnung über das
  gewählte Modell, kein Jev-Schlüssel“, wenn Jev nicht greift. Den Klickweg zum
  Hinterlegen des TypeSafe-Schlüssels übernimmst du aus der Gap-Analyse.
- **Tests**: `off` und ein fehlender TypeSafe-Schlüssel lösen **keinen** TypeSafe-Aufruf
  aus. Beide Wege liefern dasselbe Ergebnis-Schema. Die roten Abnahmefälle sind auf
  beiden Wegen rot.
- **Doku**:
  - Abnahmeleitfaden `docs/DISCLOSURE_JEV_ACCEPTANCE.md` nach dem Muster von
    `docs/JEV_ASSIST_ACCEPTANCE.md`.
  - Eintrag D-036 (bzw. die nächste freie Nummer) mit der Begründung, warum der Bereich
    anders als die Gap-Analyse (D-033) mit `on` startet.
  - `.env.example`.

## Etappe 7: SuSa

Gilt wie im Auftrag.

- Upload der Summen- und Saldenliste als weiteres Dokument des Falls.
- Parser, Konten, Zuordnung der Konten zu erkannten Zahlen und Beleg-Abgleich im Code.
- Die Quelle steht im Popover: Konto, Bezeichnung, Saldo.
- Neuer Reiter „Belege“ in der bestehenden Reiterzeile.
- Unit-Tests für Parser und Abgleich.
- Abnahme: Der SuSa-Abgleich zeigt mindestens eine rote und eine grüne Markierung. Gibt
  es keine echte SuSa zu den Beispielberichten, leg eine kleine synthetische unter
  `docs/Prüfungsberichte/` an (ignoriert, nie committen) und nenne sie mir im
  Checkpoint.

## Etappe 8: Übernahme, Freigabe, Kommentare

Gilt wie im Auftrag und D-034.

- **Korrekturschicht**: Die Dokumentblöcke bleiben unveränderlich. Eine Korrektur hat
  Person, Zeitpunkt und Begründung. Übernommen werden nur Zahlen, nie Text.
- **Zweistufig mit Serverprüfung**:
  - Ein Prüfer übernimmt, ein Manager gibt frei.
  - Prüfer und Manager müssen verschiedene Personen sein.
  - Jede Stufe erzeugt ein Audit-Event.
  - Eine Ablehnung erzeugt genau ein Ereignis.
- Fehlt die zweite Person, zeigt die Oberfläche einen gesperrten Zustand statt eines
  Fehlers.
- Verlauf und @Erwähnungen stehen im Popover, ohne Benachrichtigung.
- Die übernommene Korrektur erscheint im Dokument und im Excel-Export.
- Tests: Prüfer ≠ Manager und genau ein Ablehnungsereignis.

## Jede Etappe

- Qualitätsschritte einzeln, falls der Dev-Server `routes.d.ts` stört.
- Eigener Commit mit gezieltem `git add`, fremde Dateien nie anfassen.
- Falls nötig `pnpm db:migrate`, dann Push nach `main` und
  `curl https://openconformis.vercel.app/api/health`.
- Neue Oberflächen vor dem Checkpoint selbst per Screenshot prüfen.
- Das Abnahmeskript muss nach jeder Etappe grün bleiben.

## Checkpoint 3 (nach Etappe 8)

Halte an und schreib mir in **ganz kurzen Stichpunkten**:

- was umgesetzt ist,
- was ich testen soll, als nummerierte Schritte mit genauen Klickwegen. Dazu gehören:
  - ein Lauf mit Jev `on` und TypeSafe-Schlüssel,
  - ein Lauf ohne TypeSafe-Schlüssel,
  - der SuSa-Upload,
  - Übernahme und Freigabe mit zwei Konten. Sag mir genau, wie ich das zweite Konto
    anlege und in die Organisation bringe.
- offene Fragen als Stichpunkte, jede mit Entscheidung und Folge.

Schlüssel (Modell und TypeSafe) tippst du nie selbst. Gib mir dafür den Klickweg.
Danach folgen Etappe 9 (Vollständigkeitsprüfung) und 10 (Abschluss) laut Auftrag.
