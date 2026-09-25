# Prompt: Offenlegungspflicht – Fortsetzung mit Etappe 4 und 5

Alles unterhalb der Linie in ein neues Claude-Code-Fenster kopieren.

---

Du setzt in diesem Repository den Bereich „Offenlegungspflicht“ fort. Der vollständige
Auftrag steht in `docs/OFFENLEGUNG_SESSION_PROMPT.md` und gilt unverändert. Lies ihn
zuerst ganz, dazu `CLAUDE.md`, `DESIGN.md` und `docs/DECISIONS.md` ab D-029 (D-034 ist
neu). Etappe 1–3 sind fertig, gepusht und in Produktion migriert. Deine Aufgabe sind
**Etappe 4 und 5** und danach **Checkpoint 2** mit mir. Stell keinen neuen Gesamtplan
auf. Zeig vor dem Code nur einen kurzen Plan für Etappe 4 und 5 in Stichpunkten und leg
dann los.

## Entscheidungen, die schon gefallen sind

- Prod-Migration machst du selbst: `pnpm db:migrate` liest `.env.local` und zeigt auf die
  Produktionsdatenbank. Ausführen, **bevor** du Code pushst, der neue Tabellen liest.
  Migrationen bleiben additiv.
- Der Bereich ist in Produktion sofort sichtbar. Es gibt keinen Feature-Schalter.
- Rollen im Vier-Augen-Prinzip: Prüfer sind owner, admin, analyst und reviewer. Manager
  sind owner und admin. viewer bleibt nur lesend. Das steht in
  `src/server/disclosure/actor.ts`.
- Durchlaufen ohne Zwischenfragen. Anhalten nur bei echten Blockern und an den
  Checkpoints.
- Das Layout aus Checkpoint 1 ist abgenommen. Es bleibt so: Feststellungsliste links
  (w-72), Dokument breit in der Mitte, Popover als Detail, Zusammenfassung und
  Navigation in der Reiterzeile über dem Dokument.
- **Neu gewünscht:** ein Button „Analyse stoppen“ oben rechts in der Seitenkopfzeile
  (`CaseShell` → `PageHeader.actions`, links neben dem Sprachmenü).
  - Er ist nur sichtbar, solange ein Lauf `queued` oder `running` ist.
  - Variante `outline`, keine Primäraktion.
  - Er ruft `POST /api/disclosure/runs/[runId]/cancel` auf. Die Route beendet den
    Workflow wie die Vertragsprüfung (`src/app/api/reviews/[reviewRunId]/cancel`),
    setzt `cancelled` und löscht beide kurzlebigen Schlüssel.
  - Bereits gespeicherte Prüfungen bleiben sichtbar.
  - Ein neuer Start ist danach erlaubt. Für ihn gilt die Idempotenzregel nur für offene
    Läufe.

## Was schon existiert

- **Schema** `src/server/db/schema/disclosure.ts` (Migrationen 0054, 0055):
  - `disclosure_cases` und `disclosure_case_documents`, der Bericht mit Ordinal 0.
    Recognition-Status, `report_year` und `table_structure` liegen am Dokument.
  - `disclosure_block_context`: Seite, Tz, Tabelle, Zeile, Spalte, Kopf, Zeilen- und
    Spaltenlabel, Tabellenüberschrift, `technical`.
  - `disclosure_figures`: `value_micro` als `bigint` in **Millionstel der
    Grundeinheit** (EUR, Prozentpunkt, Stück), dazu `display_unit_micro` für die
    Rundungsregel, Skala, Einheit, Periode, `parse_issue`.
  - `disclosure_statements`: Richtung `up`, `down` oder `flat`.
- **Domäne** `src/domain/disclosure/`, reine Funktionen mit Tests:
  - `arithmetic.ts`: `compareWithTolerance` mit Toleranz × n Summanden, `roundTo`,
    `ratioPercentMicro`, `directionOf`, `formatMicro`.
  - `figures.ts`: Tokenizer, Ausschlüsse, Einheit, Periode, Einheitenvererbung.
  - `statements.ts`: Richtungswörter.
  - `document-context.ts`: Seitenmarker „PDF-Seite n“, Tz, Spaltenköpfe mit Einheit
    und Periode, Gruppenköpfe, Detailspalten erben vom rechten Nachbarn.
- **Tabellenstruktur**: `locatedBlocksFromDocumentHtml` in
  `src/domain/policies/document-structure.ts` liefert dieselbe Blockfolge wie die
  Aufbereitung plus Zelllage. `document_blocks` bleibt unverändert.
- **Server**:
  - `src/server/disclosure/recognize.ts`: Erkennung. Sie liest das Original vor der
    24-h-Löschung, erzeugt das HTML mit demselben `styleMap` wie
    `document-parser.ts` und richtet es an den gespeicherten Blöcken aus.
  - `read-plausibility.ts`: Leseseite der Erkennung.
  - `read-case.ts`, `manage-case.ts` (`attachDisclosureReport` startet die Erkennung).
  - `actor.ts`.
  - Workflow `src/workflows/disclosure-recognition.ts`, gestartet in
    `src/server/workflows/launch.ts`.
- **Oberfläche**:
  - `src/components/disclosure/plausibility-workspace.tsx`: Marken, virtuell
    verankertes Popover, Navigation über Marken mit Status `mismatch` oder
    `uncertain`, Alt+↑/↓.
  - `document-view.tsx`: echte Tabellen, Seitenmarker, OCR-Vermerk.
  - `case-shell.tsx`, `area-tabs.tsx` (shadcn-Tabs mit `line`-Variante),
    `report-upload.tsx` (nur `.docx`).
  - Die Markenstile stehen in `src/styles/globals.css` unter
    `.disclosure-document .disclosure-mark[data-status=…]`. `FigureMark.status` kennt
    schon `pending | match | mismatch | uncertain | unassigned`, und `t("status.*")`
    ist in de/en angelegt.
- **Konverter** `pnpm disclosure:pdf-to-docx`, Code in
  `src/server/disclosure/pdf-conversion/`. Die umgewandelten Beispielberichte liegen
  lokal in `docs/Prüfungsberichte/*.docx`. Der Ordner steht in `.gitignore` und wird
  nie committet.

## Etappe 4: deterministischer Plausicheck-Lauf

Gilt wie im Auftrag §7 und §8. Konkret:

- **Migration** für `disclosure_runs` mit eingefrorenen Eingaben:
  - Berichtfassung, Extraktionsversion und `configuration_hash`.
  - Route, Modell, `prompt_version`, `ai_credential_id` und `assist_credential_id`
    als nullable Spalten schon jetzt, damit Etappe 5 und 6 nur Werte setzen.
  - `workflow_run_id` mit partiellem Unique-Index, Zähler, Status, Stage und
    Fehlercode.
  - Dazu `disclosure_checks`, `disclosure_findings` und
    `disclosure_model_invocations` mit den Unique-Keys aus §8.
  - Die Enum-Werte für neue Credential-Zwecke kommen **nicht** hier, sondern in
    Etappe 5 in einer eigenen Migration.
- **Workflow** `disclosurePlausibilityWorkflow(runId)`, nur IDs als Argumente:
  prepare (Claim über `workflow_run_id`, ein Duplikat ist ein No-op) → deterministische
  Prüfungen → finalize oder fail. Vorlage sind `src/workflows/review.ts` und
  `terminalIfPermanent`.
- **Prüfungen** als reine Funktionen unter `src/domain/disclosure/checks/`, jede mit
  Tests aus Sätzen der Beispielberichte:
  - Satzarithmetik „von A um B auf C“ und „um B auf C“.
  - Richtungswort ↔ Vorzeichen.
  - Tabellensummen: nur bei eindeutiger Komponentenmenge, sonst `uncertain` ohne
    Feststellung.
  - Aktiva = Passiva.
  - Horizontale Summen über „Gesamt“-Spalten (ICBC regional).
  - Querverweis Tabelle ↔ Tabelle über gleiche Label, auch zwischen Einheiten.
  - Vorjahresspalte ↔ Vorjahresangabe.
  - Abgeleitete Posten als code-eigene Formeln: Fremdkapital = Rückstellungen +
    Verbindlichkeiten + passive RAP, Eigenkapitalquote, Provisions- und
    Nettozinsergebnis.
- **Orange-Regeln**:
  - Mehrere Kandidaten für einen Posten.
  - Abweichende Gliederung, etwa gbs Betriebsergebnis Anlage 2.2 ↔ Tz 74.
  - Das Muster „um B (Vorjahr A)“.
- **Kommentare** nur aus Code-Vorlagen, höchstens 160 Zeichen.
- **Start** über `POST /api/disclosure/cases/[caseId]/runs`:
  - Idempotent über Advisory Lock und einen offenen Lauf mit gleichem Hash.
  - In Etappe 4 ohne Schlüssel, weil ohne Modell.
  - In Etappe 5 kommt die Modellwahl davor. Plane die Route so, dass sie
    `modelProfileId` optional annimmt.
- **Oberfläche**:
  - Marken färben sich nach dem schlechtesten Check-Status je Zahl.
  - Links die Liste der Feststellungen: Titel höchstens 60 Zeichen, Seite/Tz, Status.
  - Die Zusammenfassung zeigt „452 Zahlen erkannt · 391 geprüft · 4 rot · 7 orange“.
  - Filter als kleines `Select`.
  - Fortschritt „n von m Prüfungen“, zählt nur gespeicherte Prüfungen und sinkt nie.
  - Das Popover zeigt je Prüfung Ist, Soll, Quelle und Kommentar.
  - Graue Marken nach dem Lauf: „keine Prüfbeziehung gefunden“.
  - Der Button „Analyse stoppen“ (siehe oben).

## Etappe 5: Einordnung über das Nutzermodell (BYOK)

- **Migration nur für das Enum**: `ai_credential_purpose` bekommt `disclosure`. Den
  Zod-Spiegel in `src/domain/ai/provider.ts` mit anpassen.
- **Einordnung** nur für Fundstellen, die die Regeln nicht eindeutig zuordnen:
  - Kandidaten lexikalisch aus dem Satz, höchstens 6 plus „keiner“.
  - Das Modell gibt nur IDs, Posten-Key, Periode, Konfidenz und einen Satz Kommentar
    zurück, **nie Beträge**.
  - Handgeschriebenes JSON-Schema plus Zod, Muster `reviewModelAnswerJsonSchema`.
  - Batches in parallelen Blöcken zu 8. Der Replay läuft über
    `disclosure_model_invocations (run_id, batch_key)`.
  - Die Prompt-Version wird eingefroren. Nachgerechnet wird immer im Code.
- **Schlüssel**:
  - Kurzlebiger Schlüssel mit Zweck `disclosure` über das Muster
    `createReviewRunCredential`.
  - Löschen im Finalize, im Fail- und im Cancel-Pfad.
  - Keine Secrets in Workflow-Payloads, Logs oder Audit-Metadaten.
- **Modell- und Schlüsselwahl** wie im Ergebnis der Gap-Analyse
  (`model-access-panel.tsx`, `model-key-form.tsx`), oben in der linken Spalte über
  `PlausibilityWorkspace.controls`. Start ist der einzige Primärbutton.
- **Idempotenz**: Ein zweiter Start mit denselben eingefrorenen Eingaben erzeugt keinen
  zweiten Lauf. Das deckt ein Test ab.
- **Jev ist Etappe 6** und nicht Teil dieser Session. Leg nichts an, was TypeSafe
  voraussetzt.

## Abnahmefälle, die nach Etappe 5 stimmen müssen

Siehe Auftrag §2. Die wichtigsten:

- **Rot**:
  - gbs Tz 62 „Erhöhung der Bilanzsumme“.
  - gbs Tz 80 ↔ Tz 8 (−0,6 / 0,6 Mio.).
  - ICBC Sonstige Vermögensgegenstände 774.491,78 ↔ Anhang-Summe 774.391,78.
  - ICBC regionale Zinserträge.
  - ICBC Provisionsaufwendungen 314.919,99 ↔ 314.916,59.
- **Grün**:
  - Grün mit Vermerk „gerundet“: gbs Fremdkapital 5.198 / 5.197, Jahresüberschuss
    1.507, Steuern −380, Verbindlichkeiten.
  - Grün ohne Rundung: gbs Bilanzsummen, Personalaufwand −736.
  - ICBC Nettozinsertrag, Personalaufwand +467.223,67, Provisionsergebnis und
    1.795.596.57.
- **Orange**: gbs Betriebsergebnis, ICBC Verwaltungsaufwand 2,1 Mio., gbs
  Anlagevermögen „um 72 (Vorjahr 181)“.
- **Entfällt**: Der gbs-Anlagenspiegel steht nicht im PDF. Das hat der Nutzer zur
  Kenntnis genommen.

Prüf die Fälle mit einem Skript gegen die lokale Datenbank, nachdem du die DOCX-Dateien
lokal hochgeladen hast.

## Arbeitsumgebung und Fallstricke

- Auf `https://localhost:3001` läuft der Dev-Server des Nutzers. Nicht beenden. Er
  schreibt `.next/dev/types/routes.d.ts` etwa alle 10 s neu; scheitert `pnpm typecheck`
  mit „routes.d.ts is not a module“, einfach wiederholen. Führ die Schritte von
  `pnpm quality` bei Bedarf einzeln aus.
- **Eigener Testserver** in eigenem Build-Verzeichnis, gegen die lokale Datenbank und
  ohne Anmeldung:

  ```
  APP_ENV=test E2E_DIST_SUFFIX=-claude DEPLOYMENT_MODE=local DEPLOYMENT_PROFILE=demo \
  DATABASE_URL=postgresql://conformis:conformis@127.0.0.1:5432/conformis \
  DATABASE_URL_UNPOOLED=postgresql://conformis:conformis@127.0.0.1:5432/conformis \
  LOCAL_AUTH_BYPASS=true CATALOGUE_DRIVER=fixture MODEL_CATALOGUE_DISCOVERY_DISABLED=true \
  TURNSTILE_ENFORCED=false NEXT_PUBLIC_APP_URL=http://localhost:3005 \
  WORKFLOW_LOCAL_BASE_URL=http://localhost:3005 nohup pnpm dev --port 3005 > <scratchpad>/dev.log 2>&1 & disown
  ```

  Danach `git checkout tsconfig.json next-env.d.ts`. Next trägt dort sonst
  `.next-e2e-claude` ein.

- **Lokale Postgres** im Docker-Container `openconformis-local-db` auf `127.0.0.1:5432`,
  Datenbanken `conformis` und `conformis_e2e`, Zugang `conformis`/`conformis`.
  - Läuft Docker nicht: `open -a Docker`, dann `docker start openconformis-local-db`.
  - Lokal migrieren mit `pnpm db:migrate:local`, für `conformis_e2e` mit
    `DATABASE_URL=…/conformis_e2e DATABASE_URL_UNPOOLED=…/conformis_e2e node --import tsx scripts/migrate.ts`.
- **Uploads** gehen auch lokal in den echten privaten Vercel-Blob, weil der Token aus
  `.env.local` kommt. Das ist so gewollt.
- **Parallele Sitzungen** arbeiten im selben Repository.
  - Committe nur deine eigenen Pfade mit gezieltem `git add`. Fremde, unfertige
    Dateien (etwa `scripts/tmp-*.ts`) nie anfassen oder löschen.
  - Scheitern Lint, Typen oder Build nur an so einer Datei, ist das kein Fehler deines
    Codes.
- `.npmrc` ist eingecheckt (`ignore-workspace-root-check=true`). Nicht löschen. Die
  shadcn-CLI läuft mit `pnpm exec shadcn add <name> -y < /dev/null`.
- Nach `pnpm db:generate` immer `pnpm exec prettier --write drizzle/meta` ausführen.
- **Screenshot-Prüfung**: Playwright-Skripte in den Scratchpad legen und zum Ausführen
  kurz als `./.tmp-*.mjs` ins Repository kopieren, weil `@playwright/test` aufgelöst
  werden muss. Danach wieder entfernen. Jede neue Oberfläche vor dem Checkpoint selbst
  per Screenshot prüfen.
- **Jede Etappe**: Qualitätsschritte, eigener Commit, falls nötig `pnpm db:migrate`,
  Push nach `main`, danach `curl https://openconformis.vercel.app/api/health`.

## Checkpoint 2 (nach Etappe 5)

Halte an und frag mich in **ganz kurzen Stichpunkten**:

- was umgesetzt ist,
- was ich testen soll, als nummerierte Schritte mit genauen Klickwegen,
- wie ich den Stand finde.

Für den Test brauche ich meinen eigenen Modellschlüssel. Tipp ihn nie selbst ein,
sondern gib mir den Klickweg. Danach folgen Etappe 6–10 laut Auftrag, mit Checkpoint 3
nach Etappe 8.
