# CLAUDE.md

Leitfaden für Claude Code und alle, die in diesem Repository arbeiten.

## Was das hier ist

Ein Werkzeug für die **Gap-Analyse zwischen einer internen Policy und einem
regulatorischen Rahmenwerk** — z. B. eine IKT-Sicherheitsrichtlinie gegen DORA, eine
Geldwäsche-Richtlinie gegen die EU-Geldwäsche-Verordnung. Zielgruppe sind
Compliance- und Risk-Officer in Banken und Finanzinstituten.

Das Produkt beantwortet je Anforderung genau zwei Fragen:

1. Ist die Anforderung durch die Policy **erfüllt, teilweise erfüllt oder nicht erfüllt**?
2. **Welche Textstellen** im Dokument haben zu dieser Einschätzung geführt?

Arbeitstitel, kein Markenname. Im UI erscheint kein Produktname — der Org-Switcher
in der Sidebar zeigt stattdessen das Institut („Musterbank AG / Bank").

## Aktueller Stand: erste Next.js-Umsetzung

`enterprise-wireframe/` enthält **statisches HTML/CSS/JS mit Mock-Daten**. Kein
Framework, kein Build-Schritt, kein Backend, keine KI-Aufrufe.
`enterprise-wireframe/index.html` direkt im Browser öffnen.

Die produktive Next.js-App liegt im Repository-Root. Der erste vertikale Slice
enthält App-Shell, Lokalisierung, Framework-Suche und -Auswahl sowie die initialen
Policy- und Chat-Routen. `DESIGN.md`, `docs/PRODUCT_SPEC.md`,
`docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`,
`docs/FEATURE_DELIVERY_PLAN.md`, `docs/SOURCE_AVAILABLE_AND_BYOK.md`,
`docs/MODEL_AND_PROVIDER_POLICY.md` und `docs/DECISIONS.md` bleiben die verbindliche
Planungsgrundlage.

```
enterprise-wireframe/
  index.html                Shell + Markup aller Screens
  styles.css                Basis-Styles
  enterprise-overrides.css  Design-Tokens und aktuelle Komponenten-Styles
  app.js                    Zustand, Rendering, Verdrahtung
  i18n.js                   deutsche und englische UI-Texte
  data.js                   Mock-Daten
```

## Harte Abgrenzungen

Diese Punkte sind bewusst so entschieden. Nicht ohne neue Ansage ändern:

- **Keine Verbesserungsvorschläge.** Das Werkzeug bewertet und belegt — es
  formuliert nicht um. Kein Track-Changes, kein „Übernehmen/Bearbeiten/Verwerfen",
  keine vorgeschlagenen Textbausteine. Das unterscheidet dieses Produkt vom
  Schwesterprojekt `../Conformis Demo Gap Analysis`, das genau das tut.
- **Auch „erfüllt" bekommt eine Begründung.** Ein leeres Ergebnisfeld gibt es nicht;
  bei Erfüllung stehen zwei bis drei Sätze plus Belegstellen. Für einen prüfbaren
  Nachweis zählt das Positive genauso wie die Lücke.
- **Die KI entscheidet nicht endgültig.** Jeder Status ist überschreibbar, jede
  Bewertung wird von einem Menschen bestätigt. Der Bestätigt-Zähler ist Teil der
  Kernanzeige, nicht Beiwerk.
- **Ein kohärenter Workflow.** Der komplette Workflow lebt in einer gemeinsamen
  App-Shell; die Sidebar ist der Stepper. In der Next.js-App dürfen Schritte eigene
  URLs für Reload, Deep-Link und Persistenz haben, ohne visuell zu getrennten
  Produkten zu werden.
- **Source-available ohne Maintainer-Secret.** Der Anwendungscode ist zunächst unter
  PolyForm Noncommercial 1.0.0 ausschließlich für nichtkommerzielle Nutzung
  vorgesehen. Das Projekt darf deshalb nicht als OSI Open Source bezeichnet werden.
  Kommerzielle Nutzung benötigt eine gesonderte schriftliche Lizenz. Der
  Betreiber-Key der offiziellen Instanz steht ausschließlich in
  Server-Umgebungsvariablen. Self-Hosting und lokale Tests funktionieren ohne diesen
  Key; Sponsoring ist dort standardmäßig aus.
- **Relizenzierung offenhalten.** Vor Annahme externer Codebeiträge muss ein rechtlich
  geprüfter CLA-Prozess mit ausdrücklichem Relizenzierungs- und Dual-Licensing-Recht
  aktiv sein. Ein DCO allein genügt für diese Produktentscheidung nicht. Fremde
  Abhängigkeiten und regulatorische Fremdinhalte behalten ihre eigenen Lizenz- und
  Nachweispflichten. Eigene Dokumentation, synthetische Beispieldokumente und
  eigene Mappings sind zunächst unter CC BY-NC 4.0 vorgesehen. Marken und Logos
  werden nicht zur Wiederverwendung lizenziert.
- **Ein Gratislauf ist ein Konto-Grant.** Ein erfolgreich abgeschlossener,
  kostenloser Analyse-Lauf pro verifiziertem Konto wird atomar in PostgreSQL
  reserviert und erst bei erfolgreichem Abschluss verbraucht. IP- und Bot-Signale
  dienen nur der Missbrauchserkennung. Niemals als Cookie- oder Local-Storage-Zähler
  bauen.
- **Fremde API-Keys sind kurzlebige Secrets.** Kein Key in Browser-Speicher, URLs,
  Logs oder Workflow-Payloads. Für durable Workflows nur verschlüsselt und über eine
  Credential-ID referenzieren; nach Abschluss oder TTL löschen.
- **BYOK ist provider-neutral.** Ein Nutzer darf einen Key für Requesty, OpenRouter
  oder direkt für Anthropic, Google oder OpenAI verwenden. UI und Domain-Code dürfen
  OpenRouter nicht als zwingenden Nutzer-Provider voraussetzen.
- **Modelle zeigen ihren Prüfstatus.** Evaluierte Modelle erhalten Empfehlungen.
  Technisch und datenschutzrechtlich kompatible, nicht evaluierte Modelle bleiben
  mit deutlichem Warnhinweis auswählbar. Datenschutz- oder technisch inkompatible
  Routen bleiben gesperrt.

## Workflow (Quelle der Wahrheit)

Die Sidebar führt durch vier Schritte, der Inhaltsbereich tauscht:

1. **Rahmenwerk wählen** — DORA, EU AML und MaRisk stehen als enthaltene
   Rahmenwerke oben. Weitere Rahmenwerke folgen darunter als graue, deaktivierte
   Pro-Karten mit Schloss-Icon. In der Demo ist nur DORA mit Analysedaten bespielt;
   deshalb dürfen Pro-Karten nicht in den Workflow führen.
2. **Policy hochladen** — zwei gleichrangige Wege nebeneinander (eigenes .docx/.pdf
   oder eine hinterlegte Beispiel-Policy). Keiner der beiden ist der Default.
3. **Anforderungen & Kontext** — Tabelle über alle Anforderungen. Je Zeile ein
   Schalter **einschlägig / nicht einschlägig** und, aufgeklappt, ein Freitextfeld
   **„Unternehmensspezifische Best Practice"**. Nicht einschlägige Anforderungen
   verlangen eine Begründung, die später im Ergebnis und im Export ausgewiesen wird.
4. **Ergebnis** — Split-Screen (siehe unten).

Zwischen 3 und 4 liegt vor Registrierung eine klar als Vorschau bezeichnete,
simulierte Animation ohne KI-Aufruf. Der Ergebnis-Screen bleibt unscharf. Nach
Registrierung startet der echte pg-boss-Worker und zeigt ausschließlich persistierte
Fortschrittsdaten. Beides ist **kein eigener Sidebar-Schritt**.

## Das Belegstellen-Modell

Der konzeptionelle Kern. Jede Belegstelle trägt eine Nummer, und diese Nummer
erscheint an **drei** Orten gleichzeitig:

1. inline als Badge im Begründungstext,
2. als Zeile in der Liste „Herangezogene Belegstellen" mit Fundstellenangabe,
3. als `<mark>` mit vorangestellter Nummer im Originaldokument rechts.

Hover auf einem der drei hebt die anderen beiden hervor; Klick scrollt das rechte
Pane zur Stelle und lässt sie kurz aufblitzen. Beim Wechsel der Anforderung werden
die Hervorhebungen rechts vollständig ausgetauscht — es sind immer nur die
Belegstellen der gerade aktiven Anforderung sichtbar.

**Wer eine der drei Sichten anfasst, muss die anderen zwei mitziehen.** In `data.js`
referenziert jede Belegstelle eine Block-ID aus `POLICY` und einen **wörtlichen
Substring** daraus. Stimmt der Substring nicht exakt, verschwindet die Hervorhebung
stillschweigend. Nach jeder Änderung an `POLICY` oder an einer `ev`-Liste prüfen:

```bash
node -e '
const {POLICY,REQUIREMENTS}=require("./enterprise-wireframe/data.js");
const m=Object.fromEntries(POLICY.map(b=>[b.id,b.t]));let bad=0;
const chk=(o,ev,r)=>{(ev||[]).forEach((e,i)=>{if(!(m[e.b]||"").includes(e.s)){console.log(`✗ ${o} ev${i+1} in ${e.b}`);bad++}});
 const refs=[...(r||"").matchAll(/\[\[(\d+)\]\]/g)].map(x=>+x[1]);
 for(let i=1;i<=(ev||[]).length;i++)if(!refs.includes(i)){console.log(`✗ ${o}: Beleg ${i} nicht referenziert`);bad++}};
REQUIREMENTS.forEach(r=>{chk(r.cite,r.ev,r.reason);(r.subs||[]).forEach(s=>chk(r.cite+" › "+s.cite,s.ev,s.reason))});
console.log(bad?bad+" Problem(e)":"✓ alle Belegstellen gefunden")'
```

Zwei Belegstellen derselben Anforderung dürfen sich im selben Block **nicht
überlappen** — die spätere würde nicht gerendert.

Eine Anforderung **ohne** Belegstellen ist ein gültiger Fall (siehe RTS Art. 5) und
zeigt eine ausdrückliche Leermeldung statt einer leeren Liste.

## Datenmodell

```
Rahmenwerk  →  Anforderung  →  Subanforderung
```

Jede Ebene hat **eigenen Status, eigene Begründung, eigene Belegstellen**.
Subanforderungen (bei DORA: Artikel aus RTS (EU) 2024/1774 und ITS (EU) 2024/2956)
werden im Ergebnis separat angezeigt und separat bewertet — nicht in die
Elternanforderung eingerechnet und nicht als Fußnote behandelt.

Nicht jedes Rahmenwerk hat diese zweite Ebene. Keine Annahme, dass Subanforderungen
verpflichtend sind.

Die **Best Practice** hängt an der Anforderung, ist aber **Nutzereingabe aus
Schritt 3**, kein Stammdatum aus der Administration. Sie erscheint im Ergebnis
schreibgeschützt in einem eingeklappten Block „Berücksichtigter
unternehmensspezifischer Kontext" — Nachvollziehbarkeit, was die Bewertung
beeinflusst hat.

## Administration

Zweite Fläche, bewusst nüchtern gehalten — sie darf dem Ergebnis-Screen visuell
keine Konkurrenz machen. Links die Rahmenwerke, rechts deren Anforderungen mit
Editor: Zitat, Titel, Rechtstext, geprüfte Aspekte, Subanforderungen (anlegen und
entfernen).

Alle Änderungen laufen im Wireframe gegen den In-Memory-Zustand. **Ein Reload setzt
alles zurück** — das ist für diesen Stand richtig so und keine Baustelle.

Neu angelegte Anforderungen haben kein Analyseergebnis und sagen das auch
(„Für diese Anforderung liegt noch kein Analyseergebnis vor"), statt eine Bewertung
zu erfinden.

## Design-System

`DESIGN.md` in diesem Repository ist die verbindliche Quelle für die Next.js-App.
Die Wireframe-Tokens stehen noch in `enterprise-wireframe/styles.css` und
`enterprise-wireframe/enterprise-overrides.css`.

| Rolle                            | Wert                              |
| -------------------------------- | --------------------------------- |
| Inhaltsfläche / App-Shell        | `#FFFFFF` / `#F7F8FB`             |
| Text primär / sekundär / tertiär | `#111318` / `#5B6072` / `#9198A9` |
| Hairline                         | `#E6E8EF`                         |
| Akzent / Hover / Fläche          | `#4A3AFF` / `#3C2ED9` / `#EEECFF` |
| Erfüllt                          | `#1E9E6B` auf `#E6F7EF`           |
| Teilweise erfüllt                | `#D98F1E` auf `#FDF3E1`           |
| Nicht erfüllt                    | `#DC3E3E` auf `#FCEAEA`           |
| Nicht einschlägig                | `#9198A9` auf `#F1F2F6`           |

Schrift **IBM Plex Sans** (Google Fonts) mit System-Sans als Fallback. Radius
10px auf Karten, 6px auf Chips, 999px auf Pills. Flach; eine weiche Schatten nur auf
Dialogen. Kein Dark Mode.

**Status-Farben werden ausschließlich über `STATUS` in `data.js` und die
`.st-*`-Klassen gesetzt.** Heatmap, Detail-Kopf, Sub-Einträge, Filter-Pills und die
Scoping-Tabelle greifen alle darauf zu — nie eine Statusfarbe lokal hartkodieren.

Ton: ruhig und präzise. Das Werkzeug wird unter Zeitdruck benutzt; Informationsdichte
schlägt Dekoration.

### Verbindliche Enterprise-Regeln

- Überschriften stehen für sich. Keine erklärenden Unterüberschriften direkt unter
  Seitentiteln, wenn sie nur die unmittelbar sichtbare Aufgabe wiederholen.
- Texte müssen eine Entscheidung ermöglichen oder einen Fehler verhindern. Reine
  Einführungs-, Marketing- und Orientierungssätze entfallen.
- Karten zeigen nur Informationen, die für Auswahl oder Vergleich notwendig sind.
  Beim Rahmenwerk sind das Name, Region und Verfügbarkeit beziehungsweise Anzahl der
  hinterlegten Anforderungen. Fundstelle und Sub-Regelwerke gehören in die
  Detailansicht, nicht in das Auswahlraster.
- Keine typischen KI-Oberflächenmuster: keine dekorativen Verläufe, leuchtenden
  Flächen, großen Hero-Bereiche, generischen Sparkle-Icons, Chatblasen für normale
  Workflows oder dauerhaft sichtbaren Erklärtexte.
- Keine übermäßigen Pills, Badges und Karten. Tabellen, Listen, Trennlinien und
  klare Gruppierung sind in datenintensiven Bereichen vorzuziehen.
- Keine Überschrift plus sinngleiche Unterüberschrift plus Hinweisbox. Jede
  Information erscheint genau einmal am fachlich richtigen Ort.
- Statusfarben sind semantisch, sparsam und nie dekorativ einzusetzen.
- Formulierungen sind knapp, sachlich und handlungsorientiert. Keine Texte wie
  „Wählen Sie die Grundlage, gegen die …" oder „Hier können Sie …", wenn Beschriftung
  und Steuerelement die Handlung bereits eindeutig machen.
- Upload und Beispiel-Policy sind exklusive Alternativen. Nach einer Auswahl wird
  nur das gewählte Dokument angezeigt; niemals Beispielkarte und ausgewählte Datei
  gleichzeitig.
- Der Chat ist ein sekundärer, vollflächiger Arbeitsbereich, der aus der Sidebar
  geöffnet wird. Antworten müssen Regulierungsbelege ausweisen und dürfen den
  geführten Workflow nicht ersetzen. In Version eins hat Chat keinen Policy-Kontext.
- Visuelle Grundrichtung: nahezu monochrom mit Weiß, warmem Hellgrau und sehr dunklem
  Navy. Akzentfarben werden nicht zur Dekoration verwendet; außerhalb fachlicher
  Statuswerte ist Dunkel-Navy die einzige Aktionsfarbe.
- Oberflächen bleiben flach und ruhig: feine graue Trennlinien statt Kartenschatten,
  klare Weißräume, mittlere Radien und präzise typografische Hierarchie.
- Der Prüfungsumfang ist eine Datentabelle. Spaltenreihenfolge: Checkbox für
  Einschlägigkeit, regulatorische Anforderung, Subanforderungen, Best Practice,
  Bearbeiten. Analysten ändern dort Scope und Kontext, nicht regulatorische
  Stammdaten. Analyseanweisungen werden versioniert und autorisiert verwaltet.
- Der Ergebnisbereich folgt der Prüfreihenfolge: Anforderung auswählen, Status und
  Begründung prüfen, Belege nachvollziehen, Originaldokument kontrollieren, menschlich
  bestätigen. Linien und feste Spalten strukturieren diesen Arbeitsplatz; zusätzliche
  Karten oder wiederholte Zusammenfassungen sind zu vermeiden.
- Im Ergebnis scrollt niemals die gesamte Arbeitsfläche. Anforderungsliste,
  Bewertungsdetail und Originaldokument sind drei eigenständige Scroll-Container;
  Ergebnisleiste, Statusübersicht und Spaltenköpfe bleiben fixiert.

## Sprache

UI-Texte auf **Deutsch** (Default), Englisch ist harte Anforderung. Der DE/EN-Umschalter
ist Shell-Chrome, keine Einstellung pro Screen — im Wireframe rein visuell. Bei der
echten Implementierung Strings **ab Tag 1** in eine i18n-Schicht legen; nachträglich
ist das teuer.

## Konventionen

- Mock-Daten ausschließlich in `enterprise-wireframe/data.js`, nie im Markup verstreut.
- Kommentare erklären das **Warum**, nicht das Was.
- Der Streifen „Wireframe-Navigation" am oberen Rand ist Review-Gerüst, nicht Teil
  der gedachten Produktoberfläche. Nicht als Produkt-Chrome weiterentwickeln.
- **Deep-Links für Review**: `#1` … `#4`, `#admin`, und bis auf die einzelne
  Anforderung `#4/a6` bzw. `#4/a6/a6s2`. Damit landet ein Review-Link direkt auf dem
  besprochenen Zustand. Ebenfalls Review-Gerüst, keine Produktroute.
- Keine API-Routen, keine Persistenz, keine echten Modellaufrufe in diesem Stand.

## Offene Punkte

- **19 unbespielte Rahmenwerke.** Anforderungskataloge liegen nur für DORA vor.
- Provider- und Produktentscheidungen stehen in `docs/DECISIONS.md`.
- Die geplante Dokument-, Matching-, Persistenz- und Mandantenarchitektur steht in
  `docs/ARCHITECTURE.md`; sie ist noch nicht implementiert.
- **Zweiter Einstiegspunkt „Kontrollen"** (Prüfung implementierter Maßnahmen statt
  eines Dokuments) existiert im Schwesterprojekt als Stub und ist hier bewusst nicht
  vorgesehen.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
