# Projektleitfaden

OpenConformis vergleicht eine PDF- oder DOCX-Policy mit einem versionierten
regulatorischen Rahmenwerk. Die produktive Anwendung liegt in `src/`.
Der frühere statische Wireframe wurde nach Prüfung seiner Referenzen entfernt.

## Struktur

- `src/app/`: lokalisierte Seiten, Server Actions und HTTP-Endpunkte.
- `src/components/`: Oberflächen nach Fachbereich.
- `src/domain/`: Verträge, fachliche Regeln und typisierte Beispieldaten ohne Infrastruktur.
- `src/server/`: Authentifizierung, Datenbank, Provider, Persistenz und Workflow-Schritte.
- `src/workflows/`: dauerhafte Orchestrierung; Argumente enthalten ausschließlich IDs.
- `src/messages/`: deutsche und englische UI-Texte.
- `drizzle/`: unveränderliche Migrationen samt Schema-Snapshots; nicht als Altlast löschen.
- `scripts/`: Entwicklung, Migration, Release- und Betriebsprüfungen.
- `tests/e2e/`: Browserprüfungen; Unit-Tests liegen neben dem getesteten Code.
- `docs/`: Architektur, Produktentscheidungen, Betriebsanleitungen und historische Prüfberichte.

## Produkt und Workflow

0. Anmeldung oder Registrierung vor jedem Schritt. `src/proxy.ts` erzwingt eine
   bestehende Sitzung für die gesamte App außer der Anmeldefläche selbst; ohne
   Konto kommt niemand hinein.
1. Rahmenwerk wählen. Nur veröffentlichte, verfügbare Rahmenwerke sind auswählbar.
2. Eigene Policy hochladen oder Beispiel-Policy wählen; die Auswahl ist exklusiv.
3. Prüfungsumfang und Unternehmenskontext festlegen, Modell auswählen.
4. Das Ergebnis ist zunächst eine gesperrte Vorschau ohne Modellaufruf; der Nutzer
   verbindet seinen eigenen Schlüssel und startet erst dann die echte Analyse.
5. Persistierten Fortschritt anzeigen, Ergebnisse und Belege prüfen, menschlich bestätigen,
   bei Bedarf Status begründet überschreiben und nach Excel exportieren.

Die Sidebar ist der gemeinsame Stepper; jeder Schritt darf eine eigene URL haben.
Der Chat ist ein eigener sekundärer Arbeitsbereich ohne Policy-Kontext.

## Verbindliche Regeln

- Jeder echte Analyse- und Chat-Aufruf verwendet einen eigenen API-Key des Nutzers.
  Es gibt keinen Betreiber-Key und keinen Gratislauf.
- Schlüssel nur kurzlebig verschlüsselt speichern, an Nutzer, Sitzung, Zweck und Draft
  binden und nach Abschluss oder TTL löschen. Keine Secrets in URLs, Browser-Speicher,
  Logs, Audit-Metadaten oder Workflow-Payloads.
- BYOK bleibt providerneutral. Technisch nicht funktionsfähige Routen sind gesperrt.
  Es gibt keine EU-Hosting- oder Zero-Data-Retention-Vorgabe. Nicht evaluierte
  Modelle benötigen einen deutlichen Warnhinweis.
- Rahmenwerk, Policy, Scope, Modellroute und Anweisungsversionen werden beim Start eingefroren.
  Wiederholungen dürfen keine zweite Analyse desselben Drafts erzeugen.
- Bewertungen benötigen Begründungen und genaue Belege, auch beim Status „erfüllt“.
  Keine Verbesserungsvorschläge, Textumschreibungen oder Track-Changes.
- Die KI entscheidet nicht endgültig: menschliche Bestätigung und begründeter Override bleiben erhalten.
- Belegnummern in Begründung, Belegliste und Originaldokument müssen zusammenpassen.
  Zitate sind exakte Substrings unveränderlicher Dokumentblöcke; Hervorhebungen dürfen sich
  nicht überlappen. Fehlende Belege bekommen eine ausdrückliche Leermeldung.
- Subanforderungen behalten eigene Bewertungen, Begründungen und Belege.
  Unternehmenskontext ist Nutzereingabe und keine regulatorische Stammdatenänderung.
- Nicht einschlägige Anforderungen benötigen eine Begründung für Ergebnis und Export.
- Administration verwaltet autorisiert versionierte Stammdaten und Analyseanweisungen.

## Gestaltung

`DESIGN.md` und `src/styles/globals.css` bestimmen das bestehende Design.
Oberfläche auf Basis von shadcn/ui (`src/components/ui/`, `components.json`, Basisfarbe
neutral): Neue Bedienelemente kommen aus dieser Bibliothek statt aus Nachbauten.
Inter für Fließtext und Bedienelemente, EB Garamond nur für Seitentitel, Chat-Begrüßung
und Wortmarke in der Sidebar. Ruhige weiße und graue Flächen, fast schwarzes Neutral
für Primäraktionen, semantische Statusfarben. Kein Dark Mode.
Die Sidebar ist eine schwebende shadcn-Sidebar: Gap-Analyse, Chat und Administration
sind Hauptpunkte; die vier Workflow-Schritte hängen als Unterpunkte an der Gap-Analyse.
Keine dekorativen Verläufe, redundanten Hinweise oder übermäßigen Karten und Badges.
Der Scope ist eine Tabelle: Einschlägigkeit, Anforderung, Subanforderungen, Best Practice,
Bearbeiten. Im Ergebnis scrollen Anforderungsliste, Bewertungsdetail und Originaldokument
getrennt; Übersicht und Spaltenköpfe bleiben sichtbar.
Alle UI-Texte auf Deutsch und Englisch in `src/messages/` pflegen.

## Entwicklung und Prüfung

Node 24, ausschließlich pnpm 9.12; `pnpm-lock.yaml` ist das einzige Lockfile.
`pnpm quality` prüft Formatierung, Lint, Typen, Unit-Tests, Migrationen und Build.
`pnpm test:e2e` prüft den Browserworkflow mit einer isolierten Testdatenbank;
sein Server verwendet `.next-e2e/`, damit ein laufender Entwicklungsserver weiterarbeiten kann.
Neue Tests sollen beobachtbares Verhalten und echte Fehlerfälle absichern.
Vor Löschungen Runtime-Imports, Konfiguration, Skripte und Dokumentationsverweise prüfen.
Migrationen, Lizenzen, Herkunftsnachweise und Betriebsunterlagen nicht pauschal entfernen.

## Zusammenarbeit

Rückfragen an den Nutzer immer als konkrete Stichpunkte stellen — keine Fließtextabsätze,
keine offenen Sammelfragen. Jede Frage nennt die Entscheidung und ihre Folge.
Soll der Nutzer selbst etwas tun, gehört dazu immer eine nummerierte
Schritt-für-Schritt-Anleitung mit den genauen Befehlen, Pfaden und Klickwegen —
nie nur der Hinweis, dass etwas fehlt oder zu konfigurieren ist.

## Lizenz und weiterführende Quellen

Source-available unter PolyForm Noncommercial 1.0.0; keine OSI-Open-Source-Lizenz.
Kommerzielle Nutzung erfordert schriftliche Lizenz. Externe Beiträge benötigen einen
rechtlich geprüften CLA mit Relizenzierungs- und Dual-Licensing-Rechten.
Eigene Dokumentation und Beispieldaten: CC BY-NC 4.0; Fremdinhalte behalten ihre Bedingungen.
Marken und Logos sind nicht zur Wiederverwendung lizenziert.

Aktuelle Umsetzung: `README.md`, `docs/ARCHITECTURE.md`, `docs/AI_WORKER.md`.
Produktentscheidungen: `docs/PRODUCT_SPEC.md`, `docs/DECISIONS.md`,
`docs/SOURCE_AVAILABLE_AND_BYOK.md`, `docs/MODEL_AND_PROVIDER_POLICY.md`.
Historische Lieferpläne und Prüfberichte unter `docs/` sind keine Aussage über den aktuellen Stand.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
