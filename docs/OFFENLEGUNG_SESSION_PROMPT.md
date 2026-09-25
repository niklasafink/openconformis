# Prompt: Offenlegungspflicht (Vollständigkeitsprüfung und Plausicheck)

Alles unterhalb der Linie in ein neues Claude-Code-Fenster kopieren.

---

Du baust in diesem Repository einen neuen Hauptbereich „Offenlegungspflicht“ mit zwei
Reitern: **Vollständigkeitsprüfung** (Prüfungsbericht gegen eine versionierte Checkliste
von Angabepflichten) und **Plausicheck** (alle Zahlen und Veränderungsaussagen eines
Prüfungsberichts erkennen, ohne KI nachrechnen, gegen hochgeladene Belege prüfen, im
Dokument farbig markieren, Korrekturen im Vier-Augen-Prinzip übernehmen). Ich bin kein
Entwickler. Triff alle technischen Entscheidungen selbst. Rückfragen nur als konkrete
Stichpunkte mit Entscheidung und Folge; Aufgaben für mich immer als nummerierte
Schritt-für-Schritt-Anleitung mit genauen Befehlen und Klickwegen (`CLAUDE.md`, Abschnitt
„Zusammenarbeit“).

Entscheidungen des Nutzers vom 2026-09-25, die diesen Auftrag prägen: (1) korrigierte
Zahlen dürfen übernommen werden, zweistufig durch zwei verschiedene Personen;
(2) gerechnet wird ohne KI im bestehenden TypeScript; (3) Jev (TypeSafe) ordnet
Fundstellen ein, bleibt aber abschaltbar; (4) PDF wird ohne KI nach Word konvertiert,
damit es nur einen DOCX-Parserpfad gibt; (5) Freigabe, Kommentare, Verlauf und
Dokument-Reiter werden jetzt gebaut; (6) eigene Checklisten kommen per Excel-Import;
(7) die Beispiel-PDFs bleiben lokal.

## 1. Pflichtlektüre vor dem Plan

- `CLAUDE.md` vollständig; jede Regel gilt auch hier, mit der einen in Abschnitt 10
  beschriebenen Ausnahme. `DESIGN.md`, `src/styles/globals.css`.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/AI_WORKER.md`, `docs/PRODUCT_SPEC.md`,
  `docs/DECISIONS.md` (D-030 Muster für einen neuen Bereich, D-029/D-033 Jev-Muster),
  `docs/JEV_ASSIST_ACCEPTANCE.md`, `docs/MODEL_AND_PROVIDER_POLICY.md`.
- `node_modules/next/dist/docs/` für die abweichende Next.js-Version, bevor du Code schreibst.
- Bausteine, die du wiederverwendest (Abschnitt 9), und die beiden Beispielberichte in
  `docs/Prüfungsberichte/` (Abschnitt 4). Lies beide PDFs selbst vollständig; ohne
  `pdftotext` geht das mit einem kleinen Node-Skript über `pdfjs-dist` aus `node_modules`
  (`getDocument` → `getTextContent` je Seite) oder mit `Read` und `pages`.

## 2. Ziel und Abnahmekriterien

Fertig ist die Arbeit, wenn ein angemeldeter Nutzer mit eigenem Schlüssel Folgendes
im Browser durchspielen kann und du es mit Playwright nachgewiesen hast:

1. Sidebar-Punkt „Offenlegungspflicht“ (EN „Disclosure review“) gleichrangig neben
   Gap-Analyse, Assistent, Vertragsprüfung und Administration; eigene URL `/disclosure`.
2. Neue Prüfung anlegen, Prüfungsbericht als Word hochladen (Produktivweg) oder als PDF
   (Demo/Import; wird ohne KI nach Word konvertiert, Abschnitt 5), optional eine SuSa als
   `.xlsx` als Beleg hinzufügen. Über dem Dokument erscheinen Reiter je Dokument
   („Prüfungsbericht.docx“, „SuSa 2021.xlsx“) in gespeicherter Reihenfolge.
3. Reiter „Plausicheck“: sofort nach dem Parsen sind alle erkannten Zahlen und
   Veränderungswörter grau hinterlegt (kein Modellaufruf). Nach „Prüfung starten“ (mit
   Schlüssel) färben sie sich grün, rot oder orange; ein Klick auf eine Markierung öffnet
   ein Popover mit Prüfungen, Ist/Soll, Quelle, Status und Verlauf; oben rechts navigiert
   man zur vorherigen/nächsten Anmerkung.
4. Vier-Augen-Prinzip an einer roten Feststellung: Person A (Prüfer) klickt „Übernehmen“
   (Soll-Wert wird als Korrektur gespeichert) oder „Bestätigen“ (Ist-Wert bleibt, mit
   Begründung); Person B (Manager) klickt „Freigeben“. Dieselbe Person darf nicht beide
   Stufen ausführen; der Server lehnt das ab, auch bei manipuliertem Request. Eine
   übernommene Korrektur erscheint im Dokument als korrigierter Wert neben dem
   durchgestrichenen Ist-Wert, im Verlauf des Popovers und im Export. Kommentare mit
   @Erwähnung eines Organisationsmitglieds sind im Verlauf möglich.
5. Reiter „Vollständigkeitsprüfung“: Checkliste wählen, Prüfung starten, je Position
   Status (erfüllt / teilweise / nicht erfüllt / nicht einschlägig mit Begründung / keine
   Einschätzung möglich), Begründung und exakte Zitate; Override mit Begründung; dieselbe
   zweistufige Freigabe je Position (Prüfer bestätigt, Manager gibt frei).
6. Ein zweiter Start derselben Prüfung erzeugt keinen zweiten Lauf mit denselben
   eingefrorenen Eingaben (Idempotenz wie bei `analyses`). Mit `DISCLOSURE_JEV_ASSIST=off`
   läuft alles ohne einen einzigen TypeSafe-Aufruf gleich durch.

Toleranzregel für alle Zahlenvergleiche (Abschnitt 7): Abweichung bis **eine
Anzeigeeinheit** der gröber dargestellten Zahl → **grün** mit Vermerk „gerundet“, darüber
**rot**. **Orange** gibt es ausschließlich bei unsicherer Zuordnung (Jev oder Modell
unsicher, mehrere Kandidaten, abweichende Gliederung), nie wegen Rundung.

Prüfbare Fachergebnisse an den Beispielberichten (der Plausicheck muss sie liefern):

- `117-gbs-…_Local.pdf`, Prüfungsbericht Tz 62 (S. 19): „Unter Berücksichtigung der
  **Erhöhung** der Bilanzsumme“ — die Bilanzsumme sank von 10.268,8 auf 6.828,2 TEUR.
  → **rot**, Richtungswort widerspricht den Zahlen; Quelle Anlage 2.1 / Bilanz.
- gbs, Tz 80 (S. 21): Eigenkapital per 30.06.2022 „**-0,6** Mio. EUR“, Tz 8 (S. 7):
  „verbleibenden Eigenkapital von **0,6** Mio. EUR“. → **rot**, Vorzeichenwiderspruch.
- gbs, Lagebericht S. 37: „Fremdkapital sinkt von **5.198** TEUR“; Tz 69: „Vorjahr:
  **5.197** TEUR“; Bilanz-Vorjahr 4.790.784,67 + 406.595,13 = 5.197.379,80. → **grün**
  „gerundet“ (Abweichung 0,62 TEUR ≤ 1 TEUR), Quelle im Popover benannt.
- gbs, Lagebericht S. 36: „Vorjahr Jahresüberschuss **1.507** TEUR“ vs. GuV 1.507.734,02
  und Tz 6 „TEUR 1.508“ → **grün** „gerundet“; ebenso „Steuern von -380 TEUR“ vs.
  -380.984,56 und „Verbindlichkeiten stiegen um 15 TEUR auf 422 TEUR“ (exakt 15,8).
- gbs, Bilanz S. 24/25: Anlagevermögen 10.566,00 + 98.070,00 + 50,00 = 108.686,00; Summe
  Aktiva 108.686,00 + 6.677.678,73 + 41.865,64 = 6.828.230,37; Passiva = Aktiva. → **grün**.
- gbs, Tz 5: „Personalaufwand verringerte sich um TEUR 736 auf TEUR 6.364“ mit Vorjahr
  7.099,7 → **grün** (7.099,7 − 736,0 = 6.363,7).
- gbs, PDF-Seiten 27–31 (Anhang, gescannt) und 53–54: nach der Konvertierung liegen sie
  als Textblöcke mit erkannten Zahlen vor; der Anlagenspiegel im Anhang wird gegen die
  Bilanzwerte (Sachanlagen 98.070,00 / 171.423,06) geprüft.
- `icbc_austria_…_2025.pdf`, Bilanz S. 15 (Aktiva 12.): Sonstige Vermögensgegenstände
  **774.491,78**; Anhang S. 9 (PDF-Seite 25) Fristigkeitsgliederung: 2.190,00 + 418.827,50
  - 353.374,28 = **774.391,78** = ausgewiesene Summe. → **rot**, Ist 774.491,78 /
    Soll 774.391,78, Quelle „Anhang, Fristigkeit Sonstige Vermögensgegenstände, Summe“.
    An genau dieser Feststellung wird das Vier-Augen-Prinzip in E2E durchgespielt.
- ICBC, Anhang S. 14 (PDF-Seite 30), regionale Gliederung: Zinserträge 20.936.848,26 +
  8.585.340,03 + 744.731,91 + 8.585.340,03 = 38.852.260,23 ≠ Gesamt 33.541.992,56 (= GuV);
  Provisionserträge analog (Europa und „Übrige Welt“ tragen dieselben Werte). → **rot**.
  Provisionsaufwendungen Gesamt 314.919,99 vs. GuV 314.916,59 → **rot** (3,40 EUR bei
  Cent-Genauigkeit).
- ICBC, GuV S. 16: 33.541.992,56 − 22.220.491,54 = 11.321.501,02 Nettozinsertrag;
  Anhang S. 15: Personalaufwand „um EUR 467.223,67 erhöht“ (7.305.650,30 − 6.838.426,63);
  Lagebericht S. 4: „Provisionsergebnis stieg auf TEUR 2.598,9 nach TEUR 1.001,8“ →
  alle **grün**.
- ICBC, Anhang S. 15: „auf EUR **1.795.596.57**gestiegen“ (Punkt statt Komma, fehlendes
  Leerzeichen) → wird als 1.795.596,57 erkannt und ist grün gegen die Tabelle. Ein
  Kandidat, der sich nicht normalisieren lässt, bleibt grau mit Hinweis „Zahlenformat nicht
  lesbar“ — nie stumm übersprungen.
- **Orange** (Zuordnung unsicher), nicht rot: gbs Anlage 2.2 „Betriebsergebnis -3.922,3“
  vs. Tz 74 „-3.811,9“ (andere Gliederung, neutrales Ergebnis separiert); ICBC Lagebericht
  „Verwaltungsaufwand EUR 2,1 Millionen“ (= Betriebsaufwendungen − Personalaufwand, nicht
  der GuV-Posten Sachaufwand 1,8 Mio.); gbs Lagebericht „Anlagevermögen um 72 TEUR (Vorjahr
  181 TEUR) verringert“ (Klammer ist Bestand, nicht Veränderung). **Grün**: gbs
  „Rückstellungen mit 70 %“ = 69,6 %.
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
„Reviewed“. Genau dieser Verlauf wird gebaut: KI-Befund → Prüfer (Übernehmen/Bestätigen,
Kommentar) → Manager (Freigeben) → Status „geprüft“; dazu die Markierungen, der Befund mit
Ist/Soll/Quelle, die Navigation und die Datei-Reiter für Bericht und Belege.

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
  **PDF-Seiten 27–31 (Anhang) und 53–54 haben keine Textebene** (gescannt) — der
  Konverter aus Abschnitt 5 erkennt sie per OCR. Der Bericht ist vermutlich vertraulich:
  er bleibt lokal (Abschnitt 9).
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

## 5. Dokumentpfad: PDF → Word ohne KI, ein Parserpfad

- In Produktion lädt der Nutzer Word hoch. Ein PDF wird vor dem Parsen serverseitig in
  eine DOCX konvertiert, die dann denselben Weg nimmt wie ein Word-Upload
  (`mammoth` → `blocksFromDocumentHtml` → `document_blocks`). Es gibt danach nur einen
  Parserpfad; die Originalansicht darf das PDF weiterhin zeigen, Blöcke und Offsets stammen
  aus der DOCX.
- Konverter (`src/server/policies/pdf-to-docx.ts`, Workflow-Schritt in
  `src/workflows/document-ingestion.ts`): Text- und Positionsdaten je Seite mit dem
  vorhandenen `pdfjs-dist` lesen; Zeilen aus y-Koordinaten bilden, Tabellenzeilen aus
  x-Lücken (Label + Zahlenspalten) als echte Word-Tabellen anlegen, Überschriften über
  `numberedHeadingLevel`; Seiten ohne Textebene (z. B. gbs 27–31) mit dem vorhandenen
  `tesseract.js` (deu+eng, Muster `src/server/worker/serverless-ocr.ts`, Vier-Seiten-
  Batches) erkennen und als Absätze mit OCR-Vermerk einfügen; die DOCX mit der
  MIT-lizenzierten Bibliothek `docx` (npm) erzeugen. Konverter-Version im
  `policy_versions.parser_version` festhalten; die erzeugte DOCX als `processed_object_key`
  im privaten Blob ablegen (Feld existiert).
- **Nicht** `pdf2docx` (baut auf PyMuPDF/AGPL und Python auf). Vor jeder neuen Abhängigkeit
  Lizenz prüfen (nur MIT/BSD/Apache/ISC), exakt pinnen, `pnpm license:inventory` laufen
  lassen und in `LICENSE-MANIFEST.md`/`NOTICE.md` nach Vorbild der bestehenden Einträge
  vermerken.
- OCR-Seiten bekommen im Dokument einen dezenten Hinweis „per Texterkennung gelesen“; die
  Zahlenerkennung markiert Kandidaten von OCR-Seiten wie alle anderen.

## 6. UX-Spezifikation

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
- Dokument-Reiter über dem Dokument (zweite, kleinere Tabs-Zeile mit `DocumentMark`):
  Bericht zuerst, dann Belege in `ordinal`-Reihenfolge; ein Beleg-Reiter zeigt die
  geparste SuSa als Tabelle (Konto, Bezeichnung, Saldo) mit der Zeile, auf die eine
  Feststellung verweist, hervorgehoben.
- Seitenkopf über `page-header.tsx`: Titel = Name der Prüfung (Serif), Schritt-Text
  „Offenlegungspflicht“. Rechts im Plausicheck: „Anmerkung 3 von 12“, Buttons vorherige/
  nächste (`ChevronUp`/`ChevronDown`, Tooltip, Tastatur `Alt+↑/↓`), Filter Alle / Rot /
  Orange / Offen / Vorbereitet / Geprüft als kleines `Select`. Modell- und Schlüsselwahl wie
  im Ergebnis der Gap-Analyse (`model-access-panel.tsx`, `model-key-form.tsx`), Start als
  einziger Primärbutton.
- Plausicheck-Layout: Dokument in der Mitte, breit (mindestens 60 % der Fläche), eigene
  Scrollfläche; links schmale Liste der Feststellungen (Titel ≤ 60 Zeichen, Seite/Tz,
  Freigabestatus), rechts kein dauerhaftes Panel — das Detail ist das Popover.
  Zusammenfassung über dem Dokument in einer Zeile: „452 Zahlen erkannt · 391 geprüft ·
  4 rot · 7 orange · 2 geprüft“. Übersicht und Spaltenköpfe bleiben stehen; keine
  Seiten-Scrollbar (`DESIGN.md` §2).
- Markierungen: `<mark>` mit `data-status` in der Textansicht des Dokuments; Farben aus den
  vorhandenen Statusfarben (`--status-*` in `globals.css`, grün/rot/orange, grau =
  `--muted`), nie nur Farbe: rote Marken zusätzlich mit gepunkteter Unterkante, orange
  gestrichelt, Statuswort im Popover. Marken überlappen nie; Zahl und Richtungswort sind
  getrennte Marken. Eine übernommene Korrektur zeigt den Ist-Wert durchgestrichen und
  direkt dahinter den korrigierten Wert (`<ins>`-artig, grün, mit Tooltip „übernommen von …
  am …“); der Blocktext selbst bleibt unverändert. Die aktive Marke bekommt einen
  Fokusring und wird mit 96 px Kontext in den Sichtbereich gescrollt (Muster
  `scrollToElement` im Viewer).
- Popover (`src/components/ui/popover.tsx`, Anker = Marke): Kopfzeile Statuswort + Icon +
  Freigabestatus (offen / vorbereitet / geprüft); darunter je Prüfung eine Zeile „Prüfung ·
  Ist · Soll · Quelle“ (Quelle = Seite/Tz/Tabellenzeile oder „SuSa Konto 1200 Forderungen
  L+L“), ein Kommentar von höchstens 120 Zeichen; dann der Verlauf als vertikale Liste wie
  im Referenzbild (KI-Befund, Prüfer-Aktion, Kommentare, Manager-Freigabe, Haken); unten
  die Aktionen der aktuellen Person: Prüfer sieht „Übernehmen“ (Soll-Wert, optional
  editierbar mit Pflicht-Begründung, wenn der Soll-Wert vom Vorschlag abweicht) und
  „Bestätigen“ (Ist bleibt, Begründung Pflicht), Manager sieht „Freigeben“ und
  „Zurückweisen“ (Begründung Pflicht, Status zurück auf offen); ein Kommentarfeld mit
  @Erwähnung (Tippen von `@` öffnet die Mitgliederliste der Organisation). Öffnen per
  Klick, Enter/Space (Marken sind `button`-artig mit `tabIndex`), Schließen per Escape.
  Grau markierte Zahlen zeigen „Erkannt: 4.416,4 TEUR · noch nicht geprüft“ bzw. nach dem
  Lauf „keine Prüfbeziehung gefunden“.
- Zustände: `recognizing` (Konvertieren/Parsen; graue Marken erscheinen sobald
  `document_blocks` bereit), `ready` (Start möglich), `running` mit Fortschritt „n von m
  Prüfungen“ und bereits gefärbten Marken (Fortschritt zählt gespeicherte Prüfungen, sinkt
  nie), `completed` / `completed_with_gaps` / `failed` (Fehlerursache benennen,
  Wiederholung erlaubt, kein zweiter Lauf). Ladeansichten behalten die Endmaße.
- Vollständigkeitsprüfung: dieselbe Dreiteilung wie das Ergebnis der Gap-Analyse
  (`analysis-results-workspace.tsx`): Liste der Checklistenpositionen mit Status und
  Freigabestatus, Detail mit Begründung, Belegen, Verlauf und denselben zweistufigen
  Aktionen (Prüfer bestätigt oder überschreibt mit Begründung, Manager gibt frei),
  Dokument rechts mit Zitat-Hervorhebung. Nicht einschlägig nur mit Begründung.
- Administration: neuer Abschnitt „Checklisten“ mit Liste der Releases, Excel-Import
  (Direktupload, Vorschau der erkannten Positionen, Validierung, Veröffentlichen) und
  Archivieren; Format in Abschnitt 7.
- Alle Texte Deutsch und Englisch; keine Marketing-Adjektive, keine Badges-Inflation.

## 7. Fachliche Prüflogik

**Erkennung (deterministisch, Regex und Parser, kostenlos)** in `src/domain/disclosure/`:

- Zahlentokenizer über `document_blocks.canonical_text` je Block mit UTF-16-Offsets.
  Formate: `1.234.567,89`, `4.416,4`, `-3.430`, `–890`, `24 %`, `24,0 %`, `34,04%`,
  `1,6 Mio. EUR`, `EUR 402,7 Millionen`, `TEUR 5.478`, `5.478 TEUR`, `736 T €`, `Tsd. €`,
  Klammerformen `(Vorjahr: TEUR 8.411)`, `(Vj: TEUR 124)`, `(2024: 192.707.232,71)`,
  fehlerhafte Formen `1.795.596.57`, `1.344.989,.19`, `7 .971`. Normalisiert in einen
  exakten Dezimalwert (Ganzzahl in Cent bzw. kleinster Einheit, `bigint`; kein `number`
  für Beträge), Skala (1 / 1.000 / 1.000.000), Einheit (EUR, Prozent, Anzahl, unbekannt),
  Vorzeichen, Anzeigegenauigkeit (Anzahl Nachkommastellen × Skala), Periodenhinweis
  (Berichtsjahr / Vorjahr / Sonstiges, aus Spaltenkopf oder Klammertext). Ausschlüsse:
  Datumsangaben, Jahreszahlen, Paragrafen (`§ 321 Abs. 4a`), Tz-/Absatznummern am
  Zeilenanfang, Seitenzahlen, Registernummern, Telefonnummern. Tabellenzeilen und
  Summenzeilen (Label enthält Summe / insgesamt / Gesamt / Bilanzsumme) kommen aus den
  Word-Tabellen der konvertierten DOCX (`table_cell`-Blöcke).
- Richtungswörter: stieg/stiegen/gestiegen/erhöhte(n) sich/Anstieg/verbesserte sich/
  zunahm ↔ sank/sanken/gesunken/verringerte(n) sich/verminderte sich/reduzierte sich/
  fielen/rückläufig/zurückgegangen/Rückgang/verschlechterte ↔ unverändert/
  Vorjahresniveau. Satzmuster: „von A um B auf C“, „um B auf C“, „auf C (Vorjahr A)“,
  „C (Vorjahr: A)“, „C (2024: A)“. Alles versioniert (`extraction_version`), reine
  Funktionen mit Unit-Tests aus Sätzen der beiden Berichte.

**Rechnen ohne KI** in `src/domain/disclosure/arithmetic.ts`: reine Funktionen auf
`bigint`-Cent (Addition, Differenz, Skalierung Cent → TEUR → Mio., Quotient in
Basispunkten, Vergleich mit Toleranz). Kein Float, kein Python, keine Modellarithmetik.
Toleranz: |Ist − Soll| ≤ eine Anzeigeeinheit der gröberen Darstellung → `match` mit Vermerk
„gerundet“, wenn nicht exakt; darüber `mismatch`. Bei Summen aus n gerundeten Summanden ist
die Einheit die der Summenzeile, Toleranz eine Einheit × n. Unit-Tests für jede Regel und
jeden Abnahmefall aus Abschnitt 2.

**Prüfungen (deterministisch, Code):**

1. Satzarithmetik: A ± B = C; Richtungswort ↔ Vorzeichen von C − A.
2. Tabellensummen: Summenzeile = Summe der Komponentenzeilen derselben Spalte;
   Aktiva = Passiva; Zwischensummen.
3. Querverweis Text ↔ Tabelle innerhalb des Dokuments über Einheitenwechsel (Cent → TEUR
   → Mio.): dieselbe Position im Lagebericht, Berichtsteil, Bilanz/GuV, Anlagen.
4. Vorjahr: Vorjahresspalte ↔ Vorjahresangabe im Text.
5. Quoten: Prozentangabe ↔ Quotient zweier zugeordneter Positionen (nur wenn beide
   Operanden eindeutig zugeordnet sind, sonst grau).
6. Beleg-Abgleich (SuSa): Summe der zugeordneten Kontensalden ↔ Berichtszahl.

**Einordnung durch Jev (TypeSafe), abschaltbar:** Jev bekommt je Fundstelle den Blocktext
mit Kandidaten-IDs und liefert typisiert zurück: Posten (Label), Periode (laufendes Jahr /
Vorjahr), Einheit, Bezug eines Richtungsworts auf Zahlen-IDs, Zuordnung zu Tabellenzeile
bzw. SuSa-Konto, Vorsortierung (welche Prüfung greift), jeweils mit Konfidenz. Muster:
`src/server/review/jev-client.ts`, `src/server/worker/jev-assist-client.ts`,
`src/server/ai/typesafe.ts`, Drosselung `jev-throttle.ts`, Tests
`src/server/worker/execute-analysis-jev.test.ts`. Schalter `DISCLOSURE_JEV_ASSIST=off|on`
(Default `off`, Parser in `src/server/environment.ts` nach dem Muster von
`REVIEW_DECISION_ENGINE`), Wert je Lauf in `disclosure_runs.jev_assist` eingefroren; ohne
gespeicherten TypeSafe-Schlüssel läuft der Lauf als `off`. Jev-Schlüssel ist BYOK wie alle
anderen (Zweck `disclosure_assist`, kurzlebig, Löschung im Finalize). Bei `off` übernimmt
das Nutzermodell dieselbe Einordnung mit demselben Ausgabe-Schema; kein Pfad hängt von
TypeSafe ab, `scripts/check-byok-config.ts` verlangt ihn nicht.

**Nutzermodell (BYOK, strukturierte Ausgabe)** nur für Fälle, die Jev unter der
Konfidenzschwelle lässt oder bei `off` für alle Einordnungen, und für die
Vollständigkeitsprüfung. Modell und Jev geben ausschließlich IDs erkannter Zahlen/Blöcke/
Konten, ein Label, eine Konfidenz und höchstens einen Satz Kommentar zurück — nie Beträge,
nie Rechenergebnisse. Der Code rechnet nach; Konfidenz unter Schwelle oder mehrere
Kandidaten → orange „Zuordnung unsicher“. Batches nach Blöcken/Positionen, Ausgabe-Schema
mit `zod`, Prompt-Version im Lauf eingefroren. Kommentare sind super kurz: Vorlagen aus
Code („Summe weicht um 100,00 EUR ab“, „Text sagt Erhöhung, Zahlen sinken“),
Modellkommentar ≤ 1 Satz.

**Übernahme und Freigabe (Vier-Augen-Prinzip):** Rollen aus `members.role` der
Organisation (`src/server/db/schema/auth.ts`): Prüfer = jedes Mitglied, Manager =
`owner`/`admin` — wenn die vorhandenen Rollenwerte nicht so heißen, bilde sie ab und frag
mich als Stichpunkt. Ablauf je Feststellung und je Checklistenposition: `open` →
(Prüfer: Übernehmen mit Soll-Wert oder Bestätigen, Begründung) → `prepared` → (Manager:
Freigeben) → `reviewed`; Zurückweisen → `open`. Server prüft Mitgliedschaft, Rolle und
`prepared_by_user_id ≠ reviewed_by_user_id` in einer Transaktion; Verstoß → 403 mit Code,
Audit-Event. Eine Übernahme speichert den akzeptierten Wert als Korrekturschicht, nie im
Block; Export und Dokumentansicht lesen sie dazu. Neuer Lauf oder geänderte Eingaben
invalidieren offene Freigaben (wie Bestätigungen in der Gap-Analyse).

**Vollständigkeitsprüfung**: Checklisten sind versionierte Stammdaten wie Rahmenwerke
(Entwurf/veröffentlicht/archiviert, `content_hash`, Herkunfts- und Reuse-Hinweis,
`contentClassification`). Positionen haben Referenz (z. B. „§ 285 Nr. 17 HGB“), Titel,
Anforderungstext, Prüfaspekte, optionale Unterpositionen. Bewertung je Position genau wie
die Gap-Analyse: Status, Begründung, exakte Zitate über `validateAndGroundAssessment`,
Leermeldung bei fehlenden Belegen, keine Formulierungsvorschläge. Ein kleiner Demo-Seed
(10–15 Positionen „HGB-Anhang und Lagebericht Kapitalgesellschaft (Demo)“, § 284 Abs. 2/3,
§ 285 Nr. 1, 3, 7, 9, 10, 17, 33, 34, § 289 HGB), klar als `demo` markiert. Eigene
Checklisten kommen per **Excel-Import in der Administration** als neues Release: einfaches,
dokumentiertes Spaltenformat (`Schlüssel | Referenz | Titel | Anforderung | Prüfaspekte
(durch `;` getrennt) | Übergeordnet | Reihenfolge`, erste Zeile Kopfzeile, ein Blatt),
Validierung wie beim Veröffentlichen eines Rahmenwerks (doppelte Schlüssel, leere Texte,
unbekannte Eltern), Vorschau vor dem Veröffentlichen. Das Format wird an der ersten echten
Checkliste des Nutzers nachgeschärft; dokumentiere es in `docs/OPERATIONS.md` und lege eine
Beispieldatei unter `assets/` ab.

## 8. Datenmodell (additiv, jetzt vollständig anlegen, `src/server/db/schema/disclosure.ts`)

- `disclosure_cases` (org, owner, title, status) und `disclosure_case_documents`
  (case, `role` enum `report | prior_report | evidence`, `policy_version_id` oder
  `evidence_file_id`, `ordinal` = Reiter-Reihenfolge, display_name; unique `(case_id,
ordinal)`). Die Reiter zeigen sie sofort.
- `disclosure_evidence_files` (case, kind `susa_xlsx`, filename, object_key, byte_size,
  sha256, parse_status, parser_version, `delete_after`) und
  `disclosure_evidence_accounts` (file, row, account_number, label, opening, debit,
  credit, closing als `numeric(18,2)`).
- `disclosure_figures` (case, policy_version, document_block, start/end_offset, raw_text,
  value_minor `bigint`, scale, unit, sign, display_precision, period_hint, row_label,
  extraction_version; unique `(document_block_id, start_offset)`) und
  `disclosure_statements` (Richtungswörter, gleiche Offsets-Logik, direction `up | down |
flat`).
- `disclosure_runs` (case, kind `plausibility | completeness`, status, stage, eingefroren:
  Bericht-Version, Belegdateien, Checklisten-Release, Route/Modell, prompt_version,
  extraction_version, `jev_assist` enum `off | on`, `ai_credential_id`,
  `assist_credential_id`, `workflow_run_id` unique, Zähler, failure_code/detail) und
  `disclosure_model_invocations` (unique `(run_id, batch_key)`, Anbieter `model | jev`).
- `disclosure_checks` (run, kind, status `match | mismatch | uncertain`, subject_figure,
  statement, actual_minor, expected_minor, tolerance_minor, rounded boolean, source_kind,
  source_figure/block/account_ids, comment ≤ 160, assignment_source `rule | jev | model`,
  confidence; unique je `(run_id, kind, subject_figure_id, source key)`).
- `disclosure_findings` (run, check, ordinal für die Navigation, title, page,
  `review_status` enum `open | prepared | reviewed`, `prepared_by_user_id`, `prepared_at`,
  `reviewed_by_user_id`, `reviewed_at`; Check-Constraint oder Serverregel „prepared_by ≠
  reviewed_by“), `disclosure_finding_corrections` (finding, accepted_value_minor,
  accepted_raw_text, reason, created_by, created_at; höchstens eine aktive je Finding,
  ersetzte bleiben mit `superseded_at`), `disclosure_finding_events` (append-only:
  finding, kind `ai_finding | comment | accepted | confirmed | released | rejected`,
  actor_user_id, body ≤ 2.000, created_at) und `disclosure_finding_mentions` (event,
  mentioned_user_id). Die Oberfläche darf minimal sein: der Verlauf im Popover, die
  Erwähnung als Link auf den Namen; keine Benachrichtigungen.
- Checklisten: `disclosure_checklists`, `disclosure_checklist_releases` (mit
  `source_kind` `seed | excel_import`, `source_filename`, `content_hash`),
  `disclosure_checklist_items` (parent_item_id für Unterpositionen);
  `disclosure_completeness_results`, `_evidence`, `_overrides` nach dem Muster von
  `analyses.ts`, plus dieselben Freigabefelder und `_events`/`_mentions` wie bei
  Findings (gleiche Spalten, eigene Tabellen).
- Enum `ai_credential_purpose` um `disclosure` und `disclosure_assist` erweitern (additiv).
  Migrationen nur per `pnpm db:generate`, danach `pnpm exec prettier --write drizzle/meta`
  — sonst scheitert `pnpm quality`. Bestehende Tabellen bleiben unverändert; Jev-Spalten
  und -Tabellen in einer eigenen Migration und einem eigenen Commit.

## 9. Wiederverwendung (Pfade)

- Upload-Kette: `src/domain/policies/upload.ts`, `src/server/policies/upload-service.ts`,
  `src/app/api/uploads/policy/**`, Client `src/components/reviews/review-document-upload.tsx`
  (Absicht → Blob-Direktupload → Abschluss → Ingestion). Für `.xlsx` (SuSa und
  Checklisten-Import) eine eigene Intent-Route nach demselben Muster (Vercel-Body-Limit
  4,5 MB, deshalb Direktupload), MIME
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, ZIP-Signatur plus
  `xl/workbook.xml` (Muster `hasDocxPackageEntries`), Limit 10 MB, Parsing mit `exceljs`
  (bereits Abhängigkeit) in einem Workflow-Schritt, Kopfzeile heuristisch (Konto/
  Kontonummer, Bezeichnung, EB-Wert, Soll, Haben, Saldo/Endsaldo; DATEV-Export als
  Referenzformat), Löschfrist wie Originale.
- Dokumentblöcke, Parser, OCR: `src/server/db/schema/documents.ts`,
  `src/server/worker/document-parser.ts`, `src/server/worker/serverless-ocr.ts`,
  `src/server/policies/docx-html.ts`, `src/domain/policies/document-structure.ts`,
  `src/workflows/document-ingestion.ts`.
- Zitatprüfung: `src/domain/analysis/grounding.ts` (`validateAndGroundAssessment`);
  Viewer und Hervorhebung: `src/components/results/policy-document-viewer.tsx`
  (`findQuoteRanges`, Text-/Originalansicht). Die Marken des Plausichecks laufen in der
  **Textansicht** über Block-Offsets; die Originalansicht darf dieselben Marken über
  `findQuoteRanges` zeigen, ist aber nachrangig.
- Modell, Jev und Schlüssel: `src/server/ai/structured-model.ts`, `analysis-provider.ts`,
  `typesafe.ts`, `jev-throttle.ts`, `temporary-credential-service.ts`
  (`createReviewRunCredential`, `createAnalysisAssistCredential` als Vorlagen),
  `saved-credential-service.ts`, Modellwahl `src/components/results/model-access-panel.tsx`,
  Jev-Freigabe `src/server/analyses/jev-assist-start.ts`.
- Workflow-Muster: `src/workflows/analysis.ts` (Blöcke paralleler Schritte,
  `terminalIfPermanent`), `review.ts` (Eltern/Kind, Finalize nur auf offene Zellen),
  Start `src/server/workflows/launch.ts`, Fortschritt `analysis-run-live.tsx`, `review-live.ts`.
- Bestätigen/Override/Audit: `src/server/analyses/review-analysis.ts`,
  `src/app/api/analyses/[analysisId]/results/[resultId]/**`, `src/server/audit/event.ts`;
  Mitgliedschaft und Rollen: `src/server/db/schema/auth.ts` (`members`),
  `src/server/auth/`.
- Stammdaten- und Admin-Muster: `src/server/db/schema/catalogue.ts`,
  `src/server/catalogue/seed.ts`, `admin-service.ts`, `scripts/seed-catalogue.ts`,
  `src/domain/frameworks/dora-demo-release.ts`, `src/components/admin/`.
- Export-Muster: `src/server/exports/analysis-xlsx.ts` (Feststellungen mit Ist, Soll,
  übernommenem Wert, Freigabestatus und Verlauf als Excel; Word/PDF-Export nicht jetzt).
- E2E ohne Modell: `tests/e2e/contract-review.spec.ts` und `review-seed.ts` (fertigen Lauf
  direkt in die Testdatenbank schreiben); zwei Server `chromium-gated`/`chromium-bypass`.
  Für das Vier-Augen-Prinzip brauchen die Tests zwei Nutzer derselben Organisation mit
  verschiedenen Rollen; prüfe, wie `LOCAL_AUTH_BYPASS` Nutzer bereitstellt, und erweitere
  es um einen zweiten Testnutzer.
- Beispieldokument: `scripts/generate-sample-policy.ts` als Vorlage für ein kleines
  synthetisches Beispiel „Prüfungsbericht (Demo)“ (DOCX, 2–3 Seiten Lagebericht mit
  Bilanz-Tabelle, einer eingebauten Richtungslüge und einer falschen Summe) plus die
  synthetische SuSa; beides erzeugt, nicht eingecheckt als Binärdatei, sofern das Skript
  reproduzierbar ist. Die beiden echten PDFs bleiben **lokal**: trage
  `docs/Prüfungsberichte/` in `.gitignore` ein (erster Commit), committe sie nie.

## 10. Etappen

Erst Plan-Mode: zeige den vollständigen Plan (Tabellen, Routen, Workflow-Schritte,
Prompt-Verträge, Etappen mit Commit-Titeln) und lass ihn bestätigen. Dann Etappen, jede
mit `pnpm quality`, eigenem Commit und Push nach `main` (erlaubt):

1. Grundlagen: `.gitignore` für `docs/Prüfungsberichte/`, Entscheidung D-034 (Ausnahme
   Zahlenübernahme) und knappe Anpassung in `CLAUDE.md`, Sidebar-Punkt, Routen, Tabs
   (line), Liste + Anlage einer Prüfung, Word-Upload des Berichts, Dokument-Reiter, DE/EN-
   Texte, leere Zustände.
2. PDF → DOCX-Konverter mit OCR gescannter Seiten, Lizenznachweis, Unit-Tests mit kleinen
   PDFs; danach nur noch der DOCX-Parserpfad.
3. Erkennung und Arithmetik: Tokenizer, Richtungswörter, `bigint`-Arithmetik mit
   Toleranz, Unit-Tests für jeden Abnahmefall, Persistenz der Figures/Statements, graue
   Marken, Popover-Grundgerüst, Navigation.
4. Plausicheck-Lauf, deterministischer Teil: Migrationen für Runs/Checks/Findings,
   Workflow mit ID-Argumenten, Satzarithmetik, Tabellensummen, Richtungsprüfung, Farben,
   Fortschritt.
5. Einordnung über das Nutzermodell (BYOK): Querverweise, offene Richtungssätze, kurze
   Kommentare, Einfrieren, Idempotenz, Schlüssellöschung im Finalize.
6. Jev-Einordnung als eigener Commit: `DISCLOSURE_JEV_ASSIST`, Migration, Client,
   Drosselung, Tests, die belegen, dass `off` keinen TypeSafe-Aufruf macht und dasselbe
   Ergebnis-Schema liefert; Abnahmeleitfaden nach dem Muster von
   `docs/JEV_ASSIST_ACCEPTANCE.md`.
7. SuSa: Upload, Parser, Konten, Zuordnung, Beleg-Abgleich, Quelle im Popover, Beleg-Reiter.
8. Übernahme, Freigabe, Kommentare: Korrekturschicht, zweistufiger Ablauf mit
   Serverprüfung, Verlauf und @Erwähnungen im Popover, Anzeige im Dokument, Excel-Export.
9. Vollständigkeitsprüfung: Checklisten-Schema, Demo-Seed, Excel-Import in der
   Administration, Lauf mit Zitatprüfung, Ergebnis-Arbeitsplatz, Override, zweistufige
   Freigabe je Position.
10. Abschluss: E2E-Tests (beide Reiter, ohne Modellaufruf per Seed, Vier-Augen-Prinzip mit
    zwei Nutzern), `docs/DECISIONS.md` (weitere Entscheidungen: Jev im Plausicheck,
    PDF-Konvertierung), `docs/ARCHITECTURE.md`, `docs/AI_WORKER.md`,
    `docs/PRODUCT_SPEC.md`, `docs/OPERATIONS.md`, `DESIGN.md`, `README.md`, `.env.example`.

## 11. Leitplanken

- **Ausnahme vom 2026-09-25:** `CLAUDE.md` verbietet Formulierungsvorschläge,
  Textumschreibungen und Track-Changes. Das gilt weiterhin für Text — auch im
  Plausicheck und in der Vollständigkeitsprüfung gibt es keine Satzvorschläge. Die
  Übernahme korrigierter **Zahlen** im Plausicheck ist eine bewusste Ausnahme des Nutzers:
  Trage sie als D-034 in `docs/DECISIONS.md` ein (Datum, Begründung, Grenzen: nur Zahlen,
  nur Vier-Augen, Dokumentblöcke unveränderlich, Korrekturschicht) und passe den Absatz in
  `CLAUDE.md` knapp an („… gibt es nirgends. Ausnahme: die Übernahme korrigierter Zahlen
  im Plausicheck der Offenlegungspflicht, D-034.“).
- Das Dokument bleibt unveränderlich: Blöcke, Hashes und Offsets ändern sich nie; eine
  Korrektur ist eine eigene Schicht mit Person, Zeitpunkt und Begründung.
- Zahlen und Rechnungen prüft Code mit exakter Dezimalarithmetik; keine Modell- oder
  Jev-Arithmetik als Wahrheit. Ausgaben von Jev und Modell werden schema-validiert,
  referenzieren nur IDs, und jede Zuordnung wird nachgerechnet.
- BYOK ohne Betreiber-Schlüssel, kurzlebige Schlüssel je Lauf (Zwecke `disclosure`,
  `disclosure_assist`), Löschung im Finalize/Fehlerpfad, keine Secrets in URLs, Logs,
  Audit-Metadaten oder Workflow-Payloads. Workflow-Argumente enthalten nur IDs.
- Jev bleibt abschaltbar (`DISCLOSURE_JEV_ASSIST=off` als Default, je Lauf eingefroren);
  kein Pfad setzt TypeSafe voraus; Jev-Migrationen und -Commits getrennt, damit ein
  `git revert` eine funktionierende Anwendung hinterlässt.
- Einfrieren beim Start (Berichtversion, Belege, Checkliste, Route, Modell, Jev-Schalter,
  Prompt- und Extraktionsversion). Wiederholung erzeugt keinen zweiten Lauf; unique Keys
  sind die Idempotenz. Ein dauerhaft fehlender Batch darf nicht alle anderen Ergebnisse
  verwerfen.
- Vier-Augen-Prinzip serverseitig: zwei verschiedene Personen, Rollen aus der
  Organisationsmitgliedschaft, jede Stufe mit Audit-Event.
- Hervorhebungen überlappen nie; die Erkennung ist versioniert und reproduzierbar.
- Neue Bibliotheken nur mit MIT/BSD/Apache/ISC-Lizenz, exakt gepinnt, im Lizenzinventar
  vermerkt; kein Python, kein `pdf2docx`.
- Datenbank additiv; Drizzle-Meta mit Prettier formatieren; `pnpm-lock.yaml` einziges
  Lockfile; Node 24, pnpm 9.12.
- Dev nur unter `localhost` (127.0.0.1 → 403 von Neon Auth); Safari braucht
  `PORT=3001 pnpm dev:https`; vor dem Start `curl -s localhost:3000/api/health` prüfen,
  Dev-Server mit `nohup … & disown` und Logdatei starten.
- Echte API-Schlüssel (Modell wie TypeSafe) nie selbst tippen oder in Dateien schreiben;
  wenn ich einen hinterlegen soll, nummerierte Anleitung mit Klickweg.
- Rot/Orange/Grün nie nur über Farbe; Statuswort und Icon sind Pflicht. Keine dekorativen
  Verläufe, keine Sparkle-Icons, keine Großbuchstaben-Labels.

## 12. Nicht-Ziele

Vorjahresbericht-Abgleich über Dokumente hinweg (die Rolle `prior_report` existiert, die
Prüfung dagegen nicht); Word-/PDF-Export; Benachrichtigungen für @Erwähnungen; Admin-Editor
zum Bearbeiten einzelner Checklistenpositionen (Import ersetzt ein ganzes Release);
Kapitalflussrechnungs-Logik; Chat-Anbindung an Offenlegungsprüfungen.

## 13. Definition of Done

- `pnpm quality` grün; `pnpm test:e2e` grün inklusive neuer Specs für beide Reiter und
  das Vier-Augen-Prinzip mit zwei Nutzern.
- Unit-Tests belegen jedes Fachergebnis aus Abschnitt 2 an Textauszügen der Beispiele
  (rot/orange/grün wie gefordert, „gerundet“-Fälle grün, Zuordnungsfälle orange,
  fehlerhafte Zahlenformate erkannt), die Arithmetik ohne Float, die Serverregel
  „Prüfer ≠ Manager“ und dass `DISCLOSURE_JEV_ASSIST=off` keinen TypeSafe-Aufruf auslöst.
- Manuell durchgespielt mit echtem Schlüssel: beide PDFs hochgeladen und konvertiert
  (gbs-Seiten 27–31 lesbar), Plausicheck gelaufen, die ICBC-Abweichung 774.491,78 /
  774.391,78 und die gbs-Richtungslüge „Erhöhung der Bilanzsumme“ erscheinen rot mit
  korrekter Quelle; Übernahme durch Prüfer und Freigabe durch Manager funktionieren, die
  Korrektur steht im Dokument und im Export; SuSa-Abgleich zeigt eine rote und eine grüne
  Markierung; Vollständigkeitsprüfung liefert Zitate, Override und Freigabe funktionieren;
  zweiter Start erzeugt keinen zweiten Lauf; mit Jev `on` und einem TypeSafe-Schlüssel
  läuft derselbe Bericht ebenfalls durch.
- `docs/Prüfungsberichte/` ist ignoriert und nicht committet; neue Bibliotheken stehen
  im Lizenzinventar.
- Dokumentation aktualisiert (D-034 und Folgeentscheidungen, `CLAUDE.md`-Absatz,
  Architektur, AI-Worker, Produktspezifikation, Operations mit Checklisten-Importformat,
  Design, README, `.env.example`), alle Etappen committet und gepusht, Abschlussbericht mit
  dem, was offen blieb.
