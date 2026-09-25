# Prompt: Offenlegungspflicht (Vollständigkeitsprüfung und Plausicheck)

Alles unterhalb der Linie in ein neues Claude-Code-Fenster kopieren.

---

Du baust in diesem Repository einen neuen Hauptbereich „Offenlegungspflicht“ mit zwei
Reitern: **Vollständigkeitsprüfung** (Prüfungsbericht gegen eine versionierte Checkliste
von Angabepflichten) und **Plausicheck** (alle Zahlen und Veränderungsaussagen eines
Prüfungsberichts erkennen, rechnerisch und gegen hochgeladene Belege prüfen, im Dokument
farbig markieren). Ich bin kein Entwickler. Triff alle technischen Entscheidungen selbst.
Rückfragen nur als konkrete Stichpunkte mit Entscheidung und Folge; Aufgaben für mich
immer als nummerierte Schritt-für-Schritt-Anleitung mit genauen Befehlen und Klickwegen
(`CLAUDE.md`, Abschnitt „Zusammenarbeit“).

## 1. Pflichtlektüre vor dem Plan

- `CLAUDE.md` vollständig; jede Regel gilt auch hier. `DESIGN.md`, `src/styles/globals.css`.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/AI_WORKER.md`, `docs/PRODUCT_SPEC.md`,
  `docs/DECISIONS.md` (D-030 ist das Muster für einen neuen Bereich neben der Gap-Analyse).
- `node_modules/next/dist/docs/` für die abweichende Next.js-Version, bevor du Code schreibst.
- Bausteine, die du wiederverwendest (Abschnitt 8), und die beiden Beispielberichte in
  `docs/Prüfungsberichte/` (Abschnitt 4). Lies beide PDFs selbst vollständig; ohne
  `pdftotext` geht das mit einem kleinen Node-Skript über `pdfjs-dist` aus `node_modules`
  (`getDocument` → `getTextContent` je Seite) oder mit `Read` und `pages`.

## 2. Ziel und Abnahmekriterien

Fertig ist die Arbeit, wenn ein angemeldeter Nutzer mit eigenem Schlüssel Folgendes
im Browser durchspielen kann und du es mit Playwright nachgewiesen hast:

1. Sidebar-Punkt „Offenlegungspflicht“ (EN „Disclosure review“) gleichrangig neben
   Gap-Analyse, Assistent, Vertragsprüfung und Administration; eigene URL `/disclosure`.
2. Neue Prüfung anlegen, Prüfungsbericht (PDF/DOCX) über die bestehende Upload-Kette
   hochladen, optional eine SuSa als `.xlsx` als Beleg hinzufügen.
3. Reiter „Plausicheck“: sofort nach dem Parsen sind alle erkannten Zahlen und
   Veränderungswörter grau hinterlegt (kein Modellaufruf). Nach „Prüfung starten“ (mit
   Schlüssel) färben sie sich grün, rot oder orange; ein Klick auf eine Markierung öffnet
   ein Popover mit Prüfungen, Ist/Soll, Quelle und Status; oben rechts navigiert man zur
   vorherigen/nächsten Anmerkung.
4. Reiter „Vollständigkeitsprüfung“: Checkliste wählen, Prüfung starten, je Position
   Status (erfüllt / teilweise / nicht erfüllt / nicht einschlägig mit Begründung / keine
   Einschätzung möglich), Begründung und exakte Zitate; menschlich bestätigen und mit
   Begründung überschreiben.
5. Ein zweiter Start derselben Prüfung erzeugt keinen zweiten Lauf mit denselben
   eingefrorenen Eingaben (Idempotenz wie bei `analyses`).

Prüfbare Fachergebnisse an den Beispielberichten (der Plausicheck muss sie liefern):

- `117-gbs-…_Local.pdf`, Prüfungsbericht Tz 62 (S. 19): „Unter Berücksichtigung der
  **Erhöhung** der Bilanzsumme“ — die Bilanzsumme sank von 10.268,8 auf 6.828,2 TEUR.
  → **rot**, Richtungswort widerspricht den Zahlen; Quelle Anlage 2.1 / Bilanz.
- gbs, Tz 80 (S. 21): Eigenkapital per 30.06.2022 „**-0,6** Mio. EUR“, Tz 8 (S. 7):
  „verbleibenden Eigenkapital von **0,6** Mio. EUR“. → **rot**, Vorzeichenwiderspruch.
- gbs, Lagebericht S. 37: „Fremdkapital sinkt von **5.198** TEUR“; Tz 69: „Vorjahr:
  **5.197** TEUR“; Bilanz-Vorjahr 4.790.784,67 + 406.595,13 = 5.197.379,80. → mindestens
  **orange** (Rundungsabweichung > 0,5 TEUR), Lagebericht-Wert benannt.
- gbs, Lagebericht S. 36: „Vorjahr Jahresüberschuss **1.507** TEUR“ vs. GuV 1.507.734,02
  und Tz 6 „TEUR 1.508“ → **orange** (Rundung), ebenso „Steuern von -380 TEUR“ vs.
  -380.984,56.
- gbs, Bilanz S. 24/25: Anlagevermögen 10.566,00 + 98.070,00 + 50,00 = 108.686,00; Summe
  Aktiva 108.686,00 + 6.677.678,73 + 41.865,64 = 6.828.230,37; Passiva = Aktiva. → **grün**.
- gbs, Tz 5: „Personalaufwand verringerte sich um TEUR 736 auf TEUR 6.364“ mit Vorjahr
  7.099,7 → **grün** (7.099,7 − 736,0 = 6.363,7, Rundung).
- `icbc_austria_…_2025.pdf`, Bilanz S. 15 (Aktiva 12.): Sonstige Vermögensgegenstände
  **774.491,78**; Anhang S. 9 (PDF-Seite 25) Fristigkeitsgliederung: 2.190,00 + 418.827,50
  - 353.374,28 = **774.391,78** = ausgewiesene Summe. → **rot**, Ist 774.491,78 /
    Soll 774.391,78, Quelle „Anhang, Fristigkeit Sonstige Vermögensgegenstände, Summe“.
- ICBC, Anhang S. 14 (PDF-Seite 30), regionale Gliederung: Zinserträge 20.936.848,26 +
  8.585.340,03 + 744.731,91 + 8.585.340,03 = 38.852.260,23 ≠ Gesamt 33.541.992,56 (= GuV);
  Provisionserträge analog (Europa und „Übrige Welt“ tragen dieselben Werte). → **rot**.
  Provisionsaufwendungen Gesamt 314.919,99 vs. GuV 314.916,59 → **rot** (3,40 EUR).
- ICBC, GuV S. 16: 33.541.992,56 − 22.220.491,54 = 11.321.501,02 Nettozinsertrag;
  Anhang S. 15: Personalaufwand „um EUR 467.223,67 erhöht“ (7.305.650,30 − 6.838.426,63);
  Lagebericht S. 4: „Provisionsergebnis stieg auf TEUR 2.598,9 nach TEUR 1.001,8“ →
  alle **grün**.
- ICBC, Anhang S. 15: „auf EUR **1.795.596.57**gestiegen“ (Punkt statt Komma, fehlendes
  Leerzeichen) → muss erkannt werden (Wert 1.795.596,57, grün gegen die Tabelle) oder
  orange mit Kommentar „Zahlenformat“, niemals stumm übersprungen.
- Falsch-Positive, die **nicht rot** werden dürfen: gbs Anlage 2.2 „Betriebsergebnis
  -3.922,3“ vs. Tz 74 „-3.811,9“ (andere Gliederung, neutrales Ergebnis separiert) →
  höchstens orange „abweichende Gliederung“; ICBC Lagebericht „Verwaltungsaufwand EUR 2,1
  Millionen“ (= Betriebsaufwendungen − Personalaufwand, nicht der GuV-Posten Sachaufwand
  1,8 Mio.) → orange; gbs „Rückstellungen mit 70 %“ = 69,6 % → grün (Rundung); gbs
  Lagebericht „Anlagevermögen um 72 TEUR (Vorjahr 181 TEUR) verringert“ → orange (Klammer
  ist Bestand, nicht Veränderung).
- SuSa-Abgleich: Es gibt keine echte SuSa. Erzeuge eine synthetische SuSa für gbs als
  `.xlsx` (Kontonummer, Bezeichnung, EB-Wert, Soll, Haben, Saldo; SKR04-artig) aus Bilanz
  und GuV mit einer bewusst abweichenden Position (z. B. Forderungen aus L+L 933.929,51
  statt 932.929,51) und einer exakt passenden (Guthaben bei Kreditinstituten
  4.858.728,78). Erwartung: eine rote Markierung mit Quelle „SuSa Konto 1200 …“ und eine
  grüne.

## 3. Referenzbild (Cortea „Berichtskritik Agent“) in Worten

Links ein Dokumentfenster mit drei Datei-Reitern oben: „Prüfbericht 25.pdf“, „Vorjahres-
bericht 24.pdf“, „SuSa 25.xlsx“. Darunter Fließtext des Berichts („Finanzlage … Der Cashflow
aus der laufenden Geschäftstätigkeit beträgt im Berichtsjahr 5.430 TEUR …“). Einzelne Zahlen
sind wie mit Textmarker hinterlegt: geprüfte, stimmige Zahlen hellgrün, eine fehlerhafte
(„2.750 TEUR“) hellrot; am linken Rand ein kleiner Punkt in der Zeile in derselben Farbe.
Rechts eine Karte „Berichtskritik Agent“ mit der Zeile „452 Zahlen geprüft · 4 Feststellungen“
und einer Feststellung „Kapitalflussrechnung inkorrekt“ (rotes X). Darunter ein vertikaler
Verlauf: (1) Agent-Befund „Cashflows inkonsistent mit der Veränderung des Finanzmittelfonds.
Ist: 2.750 TEUR (rot hinterlegt) · Soll: 2.710 TEUR (grün hinterlegt)“, (2) Mensch „Operativen
Cashflow in V2 angepasst“, (3) zweiter Mensch „@leon.werfel Freigegeben“, (4) Haken
„Reviewed“. Jetzt gebaut werden: die Markierungen im Dokument, der Befund mit Ist/Soll/Quelle,
die Navigation zwischen Feststellungen. Nicht jetzt: Datei-Reiter für mehrere Berichte,
Kommentare/@Erwähnungen, zweistufige Freigabe (Abschnitt 11).

## 4. Die Beispielberichte (selbst gründlich lesen)

- `117-gbs-Gesellschaft-fur-Banksysteme_Local.pdf` (54 Seiten, HGB, IDW PS 450, AWADO,
  GJ 2021): Prüfungsbericht mit nummerierten Textziffern „Tz“ (1–83), Abschnitte
  Prüfungsauftrag, Grundsätzliche Feststellungen (Lagebeurteilung, bestandsgefährdende
  Tatsachen), Bestätigungsvermerk, Rechnungslegung, Vermögens-/Finanz-/Ertragslage mit
  Tabellen in **TEUR mit einer Nachkommastelle** und Spalten `2021 | % | 2020 | % |
Veränderung TEUR | %`. Anlagen: Bilanz und GuV in **EUR mit Cent** (Spalten 31.12.2021 /
  31.12.2020), Lagebericht (Fließtext, Format „4.416 TEUR“, „736 T €“, „-3,4 Mio. EUR“),
  Anlage 2.1/2.2 Dreijahresvergleich (2021/2020/2019) mit **abweichender Gliederung**
  (ordentlich/neutral). Einheiten stehen vor oder nach der Zahl („TEUR 5.478“, „5.478
  TEUR“), Vorjahr als „(Vorjahr: TEUR 8.411)“, „(Vj: TEUR 124)“, „i.Vj.“.
  **PDF-Seiten 27–31 (Anhang) und 53–54 haben keine Textebene** (gescannt); der aktuelle
  Parser liefert dort nichts. Das muss sichtbar werden („Seiten 27–31 ohne lesbaren Text“),
  OCR einzelner Seiten ist nicht Teil dieses Auftrags.
- `icbc_austria_bank_gmbh_jahresabschluss_2025.pdf` (55 Seiten, UGB/BWG, EY Wien, GJ 2025,
  Kreditinstitut): kurzer Berichtsteil, Bestätigungsvermerk mit Key Audit Matters, Bilanz
  und GuV nach BWG-Formblatt (EUR mit Cent, „31.12.2025 in EUR | 31.12.2024 in EUR“,
  Posten unter der Bilanz mit Quoten „34,04%“), Anhang mit Fristigkeitsgliederungen
  (Tabellen „Bis 3 Monate … Summe“), Anlagenspiegel, Eigenmittel, regionale Gliederung
  der Erträge („2025 in EUR | 2024 in TEUR“ gemischt), Lagebericht mit „EUR 402,7 Millionen
  (2024: 395,4 Millionen)“, „TEUR 2.598,9“, „(2024: EUR 13.796.833,03)“. Verbalaussagen:
  „verringerte sich auf“, „erhöhte sich geringfügig auf“, „stiegen von … auf“, „reduzierte
  sich auf“. Vollständig textbasiert; Seiten 33 und 49 sind leere Trennseiten.
- Reale Plausibilitätsbeziehungen in beiden: Summenzeilen („insgesamt“, „Summe“,
  „Bilanzsumme“), Aktiva = Passiva, Text-vs-Tabelle über Einheitenwechsel (EUR-Cent ↔ TEUR
  ↔ Mio.), „von A um B auf C“, „um B auf C (Vorjahr A)“, „C (Vorjahr: A)“ mit Richtungswort,
  Quoten („Eigenkapitalquote 24 %“ = 1.641,0 / 6.828,2), Vorjahresspalte ↔ Vorjahresangabe
  im Text, derselbe Sachverhalt in Prüfungsbericht und Lagebericht (gbs Tz 5–6 wiederholt
  den Lagebericht fast wörtlich mit anderen Rundungen).

## 5. UX-Spezifikation

- Sidebar (`src/components/shell/app-sidebar.tsx`): neuer `ActiveArea` `disclosure`, Icon
  aus `lucide-react` (z. B. `FileCheck2`), Position nach Vertragsprüfung, keine Unterpunkte.
  Labels in `src/messages/de.json`/`en.json` unter `Navigation`.
- Routen unter `src/app/[locale]/(workspace)/disclosure/`: `page.tsx` (Liste + „Neue
  Prüfung“ wie `reviews/page.tsx`), `[caseId]/completeness/page.tsx`,
  `[caseId]/plausibility/page.tsx`. Der Reiter-Navigator ist eine shadcn `Tabs`-Komponente
  mit Unterstrich-Variante: `src/components/ui/tabs.tsx` existiert noch nicht; per shadcn
  CLI hinzufügen (pnpm blockiert `pnpm add`/CLI wegen `pnpm-workspace.yaml`; temporäre
  `.npmrc` mit `ignore-workspace-root-check=true`, CLI mit `-y --no-reinstall`, `.npmrc`
  danach löschen, Versionen exakt pinnen, `pnpm exec prettier --write src/components/ui`).
  Fehlt der Registry-Komponente eine `line`-Variante, ergänze sie per `cva`: kein
  Hintergrund, 2 px Unterstrich in `--foreground` unter dem aktiven Wort, Rest
  `--muted-foreground`. Die Reiter sind Links (jeder Reiter hat seine URL), `aria-current`.
- Seitenkopf über `page-header.tsx`: Titel = Name der Prüfung (Serif), Schritt-Text
  „Offenlegungspflicht“. Rechts im Plausicheck: „Anmerkung 3 von 12“, Buttons vorherige/
  nächste (`ChevronUp`/`ChevronDown`, Tooltip, Tastatur `Alt+↑/↓`), Filter Alle / Rot /
  Orange als kleines `Select`. Modell- und Schlüsselwahl wie im Ergebnis der Gap-Analyse
  (`model-access-panel.tsx`, `model-key-form.tsx`), Start als einziger Primärbutton.
- Plausicheck-Layout: Dokument in der Mitte, breit (mindestens 60 % der Fläche), eigene
  Scrollfläche; links schmale Liste der Feststellungen (rot/orange, Titel ≤ 60 Zeichen,
  Seite/Tz), rechts kein dauerhaftes Panel — das Detail ist das Popover. Zusammenfassung
  über dem Dokument in einer Zeile: „452 Zahlen erkannt · 391 geprüft · 4 rot · 7 orange“.
  Übersicht und Spaltenköpfe bleiben stehen; keine Seiten-Scrollbar (`DESIGN.md` §2).
- Markierungen: `<mark>` mit `data-status` in der Textansicht des Dokuments; Farben aus den
  vorhandenen Statusfarben (`--status-*` in `globals.css`, grün/rot/orange, grau =
  `--muted`), nie nur Farbe: rote Marken zusätzlich mit gepunkteter Unterkante, orange
  gestrichelt, Statuswort im Popover. Marken überlappen nie; Zahl und Richtungswort sind
  getrennte Marken. Die aktive Marke bekommt einen Fokusring und wird mit 96 px Kontext
  in den Sichtbereich gescrollt (Muster `scrollToElement` im Viewer).
- Popover (`src/components/ui/popover.tsx`, Anker = Marke): Kopfzeile Statuswort + Icon,
  darunter je Prüfung eine Zeile „Prüfung · Ist · Soll · Quelle“ (Quelle = Seite/Tz/
  Tabellenzeile oder „SuSa Konto 1200 Forderungen L+L“), ein Kommentar von höchstens
  120 Zeichen, unten „Vorherige / Nächste“. Öffnen per Klick, Enter/Space (Marken sind
  `button`-artig mit `tabIndex`), Schließen per Escape. Grau markierte Zahlen zeigen im
  Popover „Erkannt: 4.416,4 TEUR · noch nicht geprüft“ bzw. nach dem Lauf „keine
  Prüfbeziehung gefunden“.
- Zustände: `recognizing` (Parsen; graue Marken erscheinen sobald `document_blocks`
  bereit), `ready` (Start möglich), `running` mit Fortschritt „n von m Prüfungen“ und
  bereits gefärbten Marken (Fortschritt zählt gespeicherte Prüfungen, sinkt nie),
  `completed` / `completed_with_gaps` / `failed` (Fehlerursache benennen, Wiederholung
  erlaubt, kein zweiter Lauf). Ladeansichten behalten die Endmaße.
- Vollständigkeitsprüfung: dieselbe Dreiteilung wie das Ergebnis der Gap-Analyse
  (`analysis-results-workspace.tsx`): Liste der Checklistenpositionen mit Status, Detail
  mit Begründung und Belegen, Dokument rechts mit Zitat-Hervorhebung. Nicht einschlägig
  nur mit Begründung; Bestätigung und Override wie dort.
- Alle Texte Deutsch und Englisch; keine Marketing-Adjektive, keine Badges-Inflation.

## 6. Fachliche Prüflogik

**Erkennung (deterministisch, Code, kein Modell)** in `src/domain/disclosure/`:

- Zahlentokenizer über `document_blocks.canonical_text` je Block mit UTF-16-Offsets.
  Formate: `1.234.567,89`, `4.416,4`, `-3.430`, `–890`, `24 %`, `24,0 %`, `34,04%`,
  `1,6 Mio. EUR`, `EUR 402,7 Millionen`, `TEUR 5.478`, `5.478 TEUR`, `736 T €`, `Tsd. €`,
  Klammerformen `(Vorjahr: TEUR 8.411)`, `(Vj: TEUR 124)`, `(2024: 192.707.232,71)`,
  fehlerhafte Formen `1.795.596.57`, `1.344.989,.19`, `7 .971`. Normalisiert in
  `numeric`-Wert, Skala (1 / 1.000 / 1.000.000), Einheit (EUR, Prozent, Anzahl, unbekannt),
  Vorzeichen, Periodenhinweis (Berichtsjahr / Vorjahr / Sonstiges, aus Spaltenkopf oder
  Klammertext). Ausschlüsse: Datumsangaben, Jahreszahlen, Paragrafen (`§ 321 Abs. 4a`),
  Tz-/Absatznummern am Zeilenanfang, Seitenzahlen, Registernummern, Telefonnummern.
  Zeilen einer PDF-Tabelle liegen als Text vor (Zeilenlabel + Zahlen); erkenne
  Tabellenzeilen heuristisch (Label, dann ≥ 2 Zahlen) und Summenzeilen (Label enthält
  Summe / insgesamt / Gesamt / Bilanzsumme oder das Label einer Zwischensumme).
- Richtungswörter: stieg/stiegen/gestiegen/erhöhte(n) sich/Anstieg/verbesserte sich/
  zunahm ↔ sank/sanken/gesunken/verringerte(n) sich/verminderte sich/reduzierte sich/
  fielen/rückläufig/zurückgegangen/Rückgang/verschlechterte ↔ unverändert/
  Vorjahresniveau. Satzmuster: „von A um B auf C“, „um B auf C“, „auf C (Vorjahr A)“,
  „C (Vorjahr: A)“, „C (2024: A)“. Alles versioniert (`extraction_version`), reine
  Funktionen mit Unit-Tests aus Sätzen der beiden Berichte.

**Prüfungen (deterministisch, Code)** mit Toleranz: Abweichung ≤ 0,5 Einheiten der
angezeigten Genauigkeit → grün mit Vermerk „gerundet“; ≤ 1 Einheit → orange
„Rundungsabweichung“; darüber → rot. Bei Summen Toleranz = 0,5 × Anzahl Summanden.

1. Satzarithmetik: A ± B = C; Richtungswort ↔ Vorzeichen von C − A.
2. Tabellensummen: Summenzeile = Summe der Komponentenzeilen derselben Spalte;
   Aktiva = Passiva; Zwischensummen.
3. Querverweis Text ↔ Tabelle innerhalb des Dokuments über Einheitenwechsel (Cent → TEUR
   → Mio.): dieselbe Position im Lagebericht, Berichtsteil, Bilanz/GuV, Anlagen.
4. Vorjahr: Vorjahresspalte ↔ Vorjahresangabe im Text.
5. Quoten: Prozentangabe ↔ Quotient zweier zugeordneter Positionen (nur wenn beide
   Operanden eindeutig zugeordnet sind, sonst grau).
6. Beleg-Abgleich (SuSa): Summe der zugeordneten Kontensalden ↔ Berichtszahl.

**Modell (BYOK, strukturierte Ausgabe)** nur für Zuordnung und Unsicherheit: (a) welche
Tabellenzeile/GuV-Position gehört zu welcher Textzahl (Labels, Synonyme, Gliederungs-
unterschiede), (b) welche SuSa-Konten bilden eine Berichtsposition, (c) Richtungssätze,
die kein Muster auflöst. Das Modell gibt ausschließlich IDs erkannter Zahlen/Blöcke/Konten,
ein Label, eine Konfidenz und höchstens einen Satz Kommentar zurück — nie Beträge, nie
Rechenergebnisse. Der Code rechnet nach; Konfidenz unter Schwelle → orange „Zuordnung
unsicher“. Batches nach Blöcken/Positionen, Ausgabe-Schema mit `zod`, Prompt-Version im
Lauf eingefroren. Kommentare sind super kurz: Vorlagen aus Code („Summe weicht um
100,00 EUR ab“, „Text sagt Erhöhung, Zahlen sinken“), Modellkommentar ≤ 1 Satz.

**Vollständigkeitsprüfung**: Checklisten sind versionierte Stammdaten wie Rahmenwerke
(Entwurf/veröffentlicht/archiviert, `content_hash`, Herkunfts- und Reuse-Hinweis,
`contentClassification: demo`). Positionen haben Referenz (z. B. „§ 285 Nr. 17 HGB“), Titel,
Anforderungstext, Prüfaspekte, optionale Unterpositionen. Seed zwei kleine Demo-Listen mit
je 10–15 Positionen, die zu den Beispielen passen: „HGB-Anhang und Lagebericht
Kapitalgesellschaft (Demo)“ (§ 284 Abs. 2/3, § 285 Nr. 1, 3, 7, 9, 10, 17, 33, 34, § 289
HGB) und „UGB/BWG Anhang Kreditinstitut (Demo)“ (Fristigkeitsgliederung, Eigenmittel,
Fremdwährungsvolumen, regionale Gliederung, Prüfungshonorar § 238 UGB, Ereignisse nach
dem Stichtag). Bewertung je Position genau wie die Gap-Analyse: Status, Begründung, exakte
Zitate über `validateAndGroundAssessment`, Leermeldung bei fehlenden Belegen, keine
Formulierungsvorschläge. Eine Excel-Import-Funktion für eigene Checklisten kommt später,
das Datenmodell muss sie tragen (Positionen mit `external_key`, `display_order`, Hash).

## 7. Datenmodell-Skizze (additiv, `src/server/db/schema/disclosure.ts`)

- `disclosure_cases` (org, owner, title, status) und `disclosure_case_documents`
  (case, `role` enum `report | prior_report | evidence`, `policy_version_id` oder
  `evidence_file_id`, ordinal, display_name) — mehrere Berichte je Prüfung sind damit
  später Datei-Reiter, ohne Migration am Kern.
- `disclosure_evidence_files` (case, kind `susa_xlsx`, filename, object_key, byte_size,
  sha256, parse_status, parser_version, `delete_after`) und
  `disclosure_evidence_accounts` (file, row, account_number, label, opening, debit,
  credit, closing als `numeric(18,2)`).
- `disclosure_figures` (case, policy_version, document_block, start/end_offset, raw_text,
  value `numeric(20,4)`, scale, unit, sign, period_hint, row_label, extraction_version;
  unique `(document_block_id, start_offset)`) und `disclosure_statements` (Richtungswörter,
  gleiche Offsets-Logik, direction `up | down | flat`).
- `disclosure_runs` (case, kind `plausibility | completeness`, status, stage, eingefroren:
  Bericht-Version, Belegdateien, Checklisten-Release, Route/Modell, prompt_version,
  extraction_version, `ai_credential_id`, `workflow_run_id` unique, Zähler,
  failure_code/detail) und `disclosure_model_invocations` (unique `(run_id, batch_key)`).
- `disclosure_checks` (run, kind, status `match | mismatch | uncertain`, subject_figure,
  statement, actual, expected, tolerance, source_kind, source_figure/block/account_ids,
  comment ≤ 160, model_confidence; unique je `(run_id, kind, subject_figure_id, source
key)`) und `disclosure_findings` (run, check, ordinal für die Navigation, title, page,
  status vorerst nur `open`). Verlauf, Kommentare und zweistufige Freigabe kommen später
  als eigene Tabelle `disclosure_finding_events` (append-only, actor, kind) — jetzt nur so
  anlegen, dass Findings stabile IDs haben.
- Checklisten: `disclosure_checklists`, `disclosure_checklist_releases`,
  `disclosure_checklist_items` (parent_item_id für Unterpositionen);
  `disclosure_completeness_results`, `_evidence`, `_overrides`, `_confirmations` nach dem
  Muster von `analyses.ts`.
- Enum `ai_credential_purpose` um `disclosure` erweitern (additiv). Migrationen nur per
  `pnpm db:generate`, danach `pnpm exec prettier --write drizzle/meta` — sonst scheitert
  `pnpm quality`. Bestehende Tabellen bleiben unverändert.

## 8. Wiederverwendung (Pfade)

- Upload-Kette: `src/domain/policies/upload.ts`, `src/server/policies/upload-service.ts`,
  `src/app/api/uploads/policy/**`, Client `src/components/reviews/review-document-upload.tsx`
  (Absicht → Blob-Direktupload → Abschluss → Ingestion). Für `.xlsx` eine eigene Intent-
  Route nach demselben Muster (Vercel-Body-Limit 4,5 MB, deshalb Direktupload), MIME
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ZIP-Signatur plus
  `xl/workbook.xml` (Muster `hasDocxPackageEntries`), Limit 10 MB, Parsing mit `exceljs`
  (bereits Abhängigkeit) in einem Workflow-Schritt, Kopfzeile heuristisch (Konto/
  Kontonummer, Bezeichnung, EB-Wert, Soll, Haben, Saldo/Endsaldo; DATEV-Export als
  Referenzformat), Löschfrist wie Originale.
- Dokumentblöcke und Parser: `src/server/db/schema/documents.ts`,
  `src/server/worker/document-parser.ts`, `src/domain/policies/document-structure.ts`.
- Zitatprüfung: `src/domain/analysis/grounding.ts` (`validateAndGroundAssessment`);
  Viewer und Hervorhebung: `src/components/results/policy-document-viewer.tsx`
  (`findQuoteRanges`, Text-/Originalansicht). Die Marken des Plausichecks laufen in der
  **Textansicht** über Block-Offsets; die Originalansicht (PDF-Textebene) darf dieselben
  Marken über `findQuoteRanges` zeigen, ist aber nachrangig.
- Modell und Schlüssel: `src/server/ai/structured-model.ts`, `analysis-provider.ts`,
  `temporary-credential-service.ts` (`createReviewRunCredential` als Vorlage),
  `saved-credential-service.ts`, Modellwahl `src/components/results/model-access-panel.tsx`.
- Workflow-Muster: `src/workflows/analysis.ts` (Blöcke paralleler Schritte,
  `terminalIfPermanent`), `review.ts` (Eltern/Kind, Finalize nur auf offene Zellen),
  Start `src/server/workflows/launch.ts`, Fortschritt `analysis-run-live.tsx`, `review-live.ts`.
- Bestätigen/Override/Audit: `src/server/analyses/review-analysis.ts`,
  `src/app/api/analyses/[analysisId]/results/[resultId]/**`, `src/server/audit/event.ts`.
- Stammdaten-Muster: `src/server/db/schema/catalogue.ts`, `src/server/catalogue/seed.ts`,
  `scripts/seed-catalogue.ts`, `src/domain/frameworks/dora-demo-release.ts`.
- Export-Muster (optional, wenn Zeit): `src/server/exports/analysis-xlsx.ts`.
- E2E ohne Modell: `tests/e2e/contract-review.spec.ts` und `review-seed.ts` (fertigen Lauf
  direkt in die Testdatenbank schreiben); zwei Server `chromium-gated`/`chromium-bypass`.
- Beispieldokument: `scripts/generate-sample-policy.ts` als Vorlage für ein kleines
  synthetisches Beispiel „Prüfungsbericht (Demo)“ (DOCX, 2–3 Seiten Lagebericht mit
  Bilanz-Tabelle, einer eingebauten Richtungslüge und einer falschen Summe) plus die
  synthetische SuSa. Die beiden echten PDFs bleiben Abnahmematerial; entscheide vor dem
  Commit, ob sie ins Repository gehören (Fremdinhalte, 4 MB) oder nur lokal bleiben — frag
  mich als Stichpunkt mit Folge.

## 9. Etappen

Erst Plan-Mode: zeige den vollständigen Plan (Tabellen, Routen, Workflow-Schritte,
Prompt-Verträge, Etappen mit Commit-Titeln) und lass ihn bestätigen. Dann Etappen, jede
mit `pnpm quality`, eigenem Commit und Push nach `main` (erlaubt):

1. Shell: Sidebar-Punkt, Routen, Tabs (line), Liste + Anlage einer Prüfung, Upload des
   Berichts, DE/EN-Texte, leere Zustände.
2. Erkennung: Domain-Tokenizer und Richtungswörter mit Unit-Tests, Persistenz der
   Figures/Statements nach Ingestion, graue Marken, Popover-Grundgerüst, Navigation.
3. Plausicheck-Lauf, deterministischer Teil: Migrationen für Runs/Checks/Findings, Workflow
   mit ID-Argumenten, Satzarithmetik, Tabellensummen, Richtungsprüfung, Farben, Fortschritt.
4. Modellgestützte Zuordnung mit BYOK (Querverweise, offene Richtungssätze), kurze
   Kommentare, Einfrieren, Idempotenz, Schlüssellöschung im Finalize.
5. SuSa: Upload, Parser, Konten, Zuordnung, Beleg-Abgleich, Quelle im Popover.
6. Vollständigkeitsprüfung: Checklisten-Schema und Seeds, Lauf mit Zitatprüfung, Ergebnis-
   Arbeitsplatz, Bestätigung/Override.
7. Abschluss: E2E-Tests (beide Reiter, ohne Modellaufruf per Seed; Abnahmekriterien aus
   Abschnitt 2 als Unit-/Integrationstests gegen Textauszüge), `docs/DECISIONS.md` D-034,
   `docs/ARCHITECTURE.md`, `docs/PRODUCT_SPEC.md`, `DESIGN.md`, `README.md`.

## 10. Leitplanken

- `CLAUDE.md` verbietet Formulierungs- und Textvorschläge: Ein Soll-Wert ist ein Prüf-
  ergebnis, keine Umformulierung. Es gibt kein „Übernehmen“, das das Dokument ändert; das
  Dokument bleibt unveränderlich, Blöcke und Hashes bleiben, Positionen sind Offsets.
- Zahlen und Rechnungen prüft Code; keine Modellarithmetik als Wahrheit. Modellausgaben
  werden schema-validiert, referenzieren nur IDs, und jede Zuordnung wird nachgerechnet.
- BYOK ohne Betreiber-Schlüssel, kurzlebiger Schlüssel je Lauf (Zweck `disclosure`),
  Löschung im Finalize/Fehlerpfad, keine Secrets in URLs, Logs, Audit-Metadaten oder
  Workflow-Payloads. Workflow-Argumente enthalten nur IDs.
- Einfrieren beim Start (Berichtversion, Belege, Checkliste, Route, Modell, Prompt- und
  Extraktionsversion). Wiederholung erzeugt keinen zweiten Lauf; unique Keys sind die
  Idempotenz. Ein dauerhaft fehlender Batch darf nicht alle anderen Ergebnisse verwerfen.
- Hervorhebungen überlappen nie; die Erkennung ist versioniert und reproduzierbar.
- Jev/TypeSafe ist keine Voraussetzung; kein neuer Anbieter. Nur das gewählte BYOK-Modell.
- Datenbank additiv; Drizzle-Meta mit Prettier formatieren; `pnpm-lock.yaml` einziges
  Lockfile; Versionen exakt pinnen; Node 24, pnpm 9.12.
- Dev nur unter `localhost` (127.0.0.1 → 403 von Neon Auth); Safari braucht
  `PORT=3001 pnpm dev:https`; vor dem Start `curl -s localhost:3000/api/health` prüfen,
  Dev-Server mit `nohup … & disown` und Logdatei starten.
- Echte API-Schlüssel nie selbst tippen oder in Dateien schreiben; wenn ich einen
  hinterlegen soll, nummerierte Anleitung mit Klickweg.
- Rot/Orange/Grün nie nur über Farbe; Statuswort und Icon sind Pflicht. Keine dekorativen
  Verläufe, keine Sparkle-Icons, keine Großbuchstaben-Labels.

## 11. Nicht-Ziele (Datenmodell vorbereiten, nicht bauen)

Zweistufige Freigabe (Vorbereitet → Geprüft), Kommentare, @Erwähnungen und Verlauf je
Feststellung; Datei-Reiter für mehrere Berichte je Prüfung und Vorjahresbericht-Abgleich
über Dokumente hinweg; Word-/PDF-Export; Checklisten-Import per Excel und Admin-Editor für
Checklisten; OCR gescannter Einzelseiten in sonst textbasierten PDFs; Kapitalfluss-
rechnungs-Logik; Chat-Anbindung an Offenlegungsprüfungen.

## 12. Definition of Done

- `pnpm quality` grün; `pnpm test:e2e` grün inklusive neuer Specs für beide Reiter.
- Unit-Tests belegen jedes Fachergebnis aus Abschnitt 2 an Textauszügen der Beispiele
  (rot/orange/grün wie gefordert, Falsch-Positive nicht rot, fehlerhafte Zahlenformate
  erkannt, Seiten ohne Textebene gemeldet).
- Manuell durchgespielt mit echtem Schlüssel: beide PDFs hochgeladen, Plausicheck gelaufen,
  die ICBC-Abweichung 774.491,78 / 774.391,78 und die gbs-Richtungslüge „Erhöhung der
  Bilanzsumme“ erscheinen rot mit korrekter Quelle; SuSa-Abgleich zeigt eine rote und
  eine grüne Markierung; Vollständigkeitsprüfung liefert Zitate, Bestätigung und Override
  funktionieren; zweiter Start erzeugt keinen zweiten Lauf.
- Dokumentation aktualisiert (D-034, Architektur, Produktspezifikation, Design, README),
  alle Etappen committet und gepusht, Abschlussbericht mit dem, was offen blieb.
