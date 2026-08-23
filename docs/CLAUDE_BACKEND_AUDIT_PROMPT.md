# Anweisung für die Backend-Prüfung mit Claude Code

Führe eine vollständige, evidenzbasierte Prüfung des Backends von OpenConformis durch. Das Ziel dieser Prüfung besteht darin, vor dem öffentlichen Beta-Start festzustellen, ob das Backend fachlich korrekt, sicher, mandantenfähig, ausfallsicher, datenschutzgerecht und innerhalb der vorgesehenen Vercel- und Neon-Architektur betreibbar ist. Behandle die Anwendung als regulatorisch sensibles System. Eine oberflächliche Code-Review oder eine reine Auflistung allgemeiner Best Practices reicht nicht aus.

Du arbeitest zunächst ausschließlich prüfend. Verändere keinen Anwendungscode, keine Datenbank, keine Cloud-Ressourcen, keine Umgebungsvariablen und keine externen Systeme. Erstelle keine Deployments und führe keine Migrationen gegen eine produktive oder gemeinsam genutzte Datenbank aus. Wenn du einen Fehler findest, dokumentiere ihn mit Belegen und einem konkreten Lösungsvorschlag. Implementiere die Lösung erst, nachdem der Nutzer die Behebung ausdrücklich beauftragt hat.

## Verbindlicher Produkt- und Architekturkontext

Lies zuerst `CLAUDE.md` vollständig. Lies danach mindestens `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PRODUCT_SPEC.md`, `docs/MODEL_AND_PROVIDER_POLICY.md`, `docs/SOURCE_AVAILABLE_AND_BYOK.md`, `docs/SECURITY.md`, `.env.example`, `package.json`, `next.config.ts`, `src/proxy.ts`, die Drizzle-Konfiguration, sämtliche Datenbankschemata und Migrationen sowie die Workflow-Implementierung. Falls eine der genannten Dateien nicht vorhanden ist, dokumentiere dies als fehlende Prüfbasis und arbeite mit den tatsächlich vorhandenen Quellen weiter.

Behandle `docs/ARCHITECTURE.md` und die jeweils neuesten, ausdrücklich als aktuell gekennzeichneten Architekturentscheidungen als Soll-Zustand. Ältere Entscheidungen in `docs/DECISIONS.md` können durch spätere Entscheidungen ersetzt worden sein. Weise auf widersprüchliche oder veraltete Dokumentation hin, ohne daraus automatisch einen Fehler im Code abzuleiten.

Die aktuell vorgesehene Betriebsarchitektur besteht aus einer Next.js-Anwendung auf Vercel in Frankfurt, Vercel Functions, Vercel Workflow für dauerhafte Hintergrundverarbeitung, privatem Vercel Blob Storage, Neon PostgreSQL in Frankfurt, Neon Auth und auswählbaren externen KI-Providern. Es soll keinen dauerhaft laufenden eigenen Worker, kein Redis und keinen zusätzlichen Fly.io- oder Render-Dienst geben. Drizzle ORM ist die Datenzugriffsschicht. Die öffentliche Beta darf ausschließlich Testdokumente, synthetische Dokumente und nicht vertrauliche Inhalte verarbeiten.

## Nutzung der bereits installierten Skills

Ermittle zu Beginn die tatsächlich verfügbaren Skills und Plugins in der aktuellen Claude-Code-Umgebung. Lies die vollständige `SKILL.md` jedes Skills, den du für die Prüfung einsetzt. Verwende nicht nur dein vortrainiertes Wissen, wenn ein installierter Skill aktuelle produktspezifische Prüfregeln oder Dokumentationsquellen bereitstellt.

Nutze aus dem aktivierten Vercel-Plugin mindestens die Skills `nextjs`, `auth`, `routing-middleware`, `vercel-functions`, `workflow`, `vercel-storage`, `env-vars`, `deployments-cicd` und `verification`, soweit ihre Triggerbedingungen zur vorhandenen Implementierung passen. Nutze `runtime-cache` und `cdn-caching` für die Prüfung von Cache-Grenzen, privaten Responses und mandantenbezogenen Cache-Keys. Nutze `ai-sdk` oder `ai-gateway` nur dann, wenn das Repository diese Komponenten tatsächlich verwendet. Erzwinge keine Architekturänderung auf Vercel AI SDK oder Vercel AI Gateway, wenn die vorhandenen providerneutralen Adapter die Anforderungen bereits erfüllen.

Nutze den installierten Skill `turnstile-spin` nur zur Beurteilung einer bereits vorhandenen Turnstile-Integration und nur innerhalb seiner dokumentierten Grenzen. Erstelle während dieses Audits kein Widget, keinen Cloudflare Worker und kein Secret. Nutze Cloudflare-Worker-, Durable-Object- oder Agents-SDK-Skills nicht für den Anwendungskern, weil diese Technologien nicht zum aktuellen Soll-Zustand gehören. Falls du einen Skill bewusst nicht verwendest, obwohl sein Name thematisch ähnlich klingt, begründe die Abgrenzung kurz im Auditbericht.

Nutze für Next.js keine veralteten Annahmen. Lies die im Repository installierte Next.js-Dokumentation unter `node_modules/next/dist/docs/`, bevor du Aussagen über Next.js 16, Proxy beziehungsweise Middleware, Server Components, Route Handler, Caching, Cookies oder Request APIs triffst. Prüfe externe oder zeitabhängige Aussagen anhand aktueller Primärdokumentation von Vercel, Neon, Next.js oder dem betroffenen Provider und verlinke diese Quellen im Bericht.

## Vorgehensweise

Beginne mit einer Bestandsaufnahme. Ermittle alle Backend-Einstiegspunkte, Route Handler, Server Actions, Workflow-Definitionen, Cron-Endpunkte, Webhooks, Datenbankzugriffe, Storage-Zugriffe, Authentifizierungsadapter, Provideradapter, KI-Aufrufe und administrativen Endpunkte. Erstelle daraus eine kompakte Angriffs- und Datenflussübersicht. Verlasse dich nicht nur auf Dateinamen. Verfolge für jeden relevanten Pfad die tatsächlichen Aufrufketten bis zu Datenbank, Blob Storage, Workflow oder externem Provider.

Prüfe anschließend jeden Befund am vollständigen Codepfad. Ein fehlender Check in einem Route Handler ist beispielsweise nicht automatisch eine Schwachstelle, wenn der aufgerufene Service die Autorisierung korrekt und unvermeidbar durchsetzt. Umgekehrt gilt ein Check in der Oberfläche niemals als Sicherheitskontrolle. Alle sicherheitsrelevanten Aussagen müssen auf serverseitigem Verhalten beruhen.

Führe sichere, lokale und reproduzierbare Prüfkommandos aus. Dazu gehören mindestens `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:check` und `pnpm build`. Führe E2E-Tests aus, wenn die lokale Umgebung ohne produktive Secrets und ohne irreversible externe Aktionen gestartet werden kann. Verwende niemals echte Policies oder echte Nutzer-API-Keys als Testdaten. Gib Secrets weder in Befehlsausgaben noch im Auditbericht aus.

Unterscheide klar zwischen nachgewiesenen Fehlern, begründeten Risiken, Dokumentationsabweichungen und nicht prüfbaren Annahmen. Kennzeichne einen Punkt nicht als bestanden, wenn die erforderliche Konfiguration oder ein realistischer Test fehlt. Verwende in diesem Fall den Status „nicht verifiziert“ und beschreibe exakt, welcher Nachweis fehlt.

## Authentifizierung und Sitzungsverwaltung

Prüfe den vollständigen Neon-Auth-Ablauf für E-Mail und Passwort, Magic Link, Google OAuth und Microsoft OAuth. Verfolge Registrierung, Anmeldung, Callback, Session-Cookie, Session-Erneuerung, Abmeldung und den erneuten Einstieg in ein bereits gestartetes Ergebnis. Stelle sicher, dass erfolgreiche Authentifizierung nicht nur in Neon Auth existiert, sondern zuverlässig in eine Anwendungssitzung und die lokale Nutzerprojektion überführt wird.

Prüfe insbesondere die erlaubten Origins, absoluten Callback-URLs, Proxy- beziehungsweise Middleware-Verarbeitung, Host- und Protokollwechsel, SameSite-Einstellungen, Secure-Cookies, lokale Entwicklung und die spätere Produktionsdomain `open.conformisgrc.com`. Berücksichtige, dass der Neon-Magic-Link eine Challenge im ursprünglich verwendeten Browserprofil voraussetzen kann. Ein fehlender oder abgelaufener Challenge-Cookie darf weder zu einer 404-Seite noch zu einer Weiterleitungsschleife führen. Die Anwendung muss einen sicheren und verständlichen Wiederholungsweg anbieten.

Prüfe die fachliche Trennung zwischen einer gültigen Sitzung und einer verifizierten E-Mail. Ein neu registrierter Nutzer muss seinen geschützten Arbeitsbereich erreichen können. Rechtlich relevante menschliche Bestätigungen oder Status-Overrides dürfen weiterhin eine verifizierte E-Mail und die erforderliche Rolle verlangen. Weise auf inkonsistente Prüfungen zwischen Seiten, APIs und Services hin.

Prüfe, ob Authentifizierungsfehler ohne interne Providerdetails, Tokens, E-Mail-Existenz oder Stack-Traces zurückgegeben werden. Untersuche, ob Registrierung, Login, Magic Link, Passwortversuche und OAuth-Callbacks angemessen gegen Missbrauch begrenzt sind.

## Autorisierung und Mandantentrennung

Behandle die Mandantentrennung als kritischsten Sicherheitsbereich. Jeder registrierte Nutzer muss ausschließlich auf seine Organisation, seine Analysen, seine Policies, seine Dokumentblöcke, seine Exporte, seine Chatverläufe, seine temporären Credentials und seine Auditdaten zugreifen können. Prüfe dies für jede lesende und schreibende Route sowie für jeden Hintergrundprozess.

Verfolge die anonyme Draft-ID vom Rahmenwerk über Policy und Prüfungsumfang bis zur Registrierung. Prüfe, ob der Draft beim ersten echten Analysestart atomar genau einem Nutzer und genau einer Organisation zugeordnet wird. Zwei Konten dürfen denselben Draft nicht gleichzeitig oder nacheinander übernehmen können. Ein Nutzer darf durch manipulierte IDs, Query-Parameter, Request-Bodies oder direkte API-Aufrufe keine Daten eines anderen Nutzers erhalten.

Prüfe jede Datenbankabfrage auf notwendige Bedingungen für `ownerUserId`, `organizationId`, Mitgliedschaft, Rolle und Löschstatus. Achte besonders auf IDOR-Risiken in Analyseergebnissen, Dokumentansichten, Belegstellen, Excel-Exporten, Chat-Threads, temporären API-Credentials, Löschrouten und administrativen Endpunkten. Ein nicht autorisierter Zugriff sollte nach Möglichkeit keine Existenz fremder Ressourcen offenlegen.

Prüfe, ob globale Administratorrechte eindeutig von organisationsbezogenen Rollen getrennt sind. Ein Nutzer, der in seiner automatisch angelegten Organisation die Rolle `owner` besitzt, darf dadurch nicht automatisch regulatorische Rahmenwerke, Modellfreigaben oder globale Analyseanweisungen administrieren. Untersuche auch, ob Rollenänderungen und Mitgliedschaften revisionssicher und gegen Rechteausweitung geschützt sind.

## Datenmodell, Transaktionen und Datenintegrität

Prüfe alle Drizzle-Schemata, Migrationen, Fremdschlüssel, Unique Constraints, Check Constraints, Indizes und Löschregeln. Stelle sicher, dass fachliche Invarianten nicht ausschließlich im TypeScript-Code bestehen, wenn sie zuverlässig durch PostgreSQL abgesichert werden können.

Prüfe die Transaktionen für Nutzerprojektion, Workspace-Erstellung, Draft-Übernahme, Sponsored-Grant-Reservierung, Analysestart, Ergebnisfinalisierung, Grant-Verbrauch und Löschung. Untersuche Race Conditions bei parallelen Requests, doppelten Browser-Tabs, Workflow-Retries und wiederholten Webhooks. Prüfe Advisory Locks und Idempotency-Keys darauf, ob sie den richtigen fachlichen Schlüssel und nicht nur einen zufälligen Request abdecken.

Prüfe, ob ein abgebrochener oder fehlgeschlagener Lauf einen reservierten Gratislauf korrekt freigibt beziehungsweise einen begrenzten Wiederholungsweg ermöglicht. Ein erfolgreicher Lauf darf den Grant genau einmal verbrauchen. Ein Nutzer darf durch neue Drafts, parallele Starts, Fehlermeldungen oder Account-Wiederverwendung keine unbegrenzten Sponsored-Runs erzeugen.

Prüfe Zeitstempel, Statusübergänge und Soft-Delete-Felder auf monotone und widerspruchsfreie Übergänge. Stelle sicher, dass gelöschte oder abgelaufene Ressourcen nicht über Nebenpfade weiterhin erreichbar sind.

## Datei-Upload, Parsing und OCR

Prüfe den vollständigen Uploadpfad für PDF und DOCX bis maximal 25 MB. Stelle sicher, dass Dateiname, deklarierter MIME-Typ, erkannter MIME-Typ, Dateigröße, Blob-Pfad und Upload-Intent serverseitig miteinander abgeglichen werden. Eine Clientvalidierung allein reicht nicht aus.

Untersuche Risiken durch manipulierte Office-Dateien, ZIP-Bombs, übergroße entpackte Inhalte, beschädigte PDFs, extrem viele Seiten, sehr große Bilder, Parser-Hänger und OCR-Ressourcenverbrauch. Prüfe, ob Parser und OCR harte Grenzen für Seiten, Bytes, Laufzeit, Speicher und Ausgabemenge besitzen. Externe Referenzen, Makros, eingebettete Objekte und aktive Inhalte dürfen nicht ausgeführt oder unkontrolliert abgerufen werden.

Prüfe, ob private Blob-Objekte ausschließlich serverseitig und nach Autorisierung gelesen werden. Signierte oder temporäre URLs dürfen keine überlange Gültigkeit besitzen und nicht in Logs, Analytics oder Fehlermeldungen erscheinen. Prüfe auch den synthetischen Sample-Policy-Pfad, da eingebettete Beispieldokumente dieselben Datenbankinvarianten wie Uploads erfüllen müssen.

## Vercel Workflow und Hintergrundverarbeitung

Nutze den installierten Vercel-Workflow-Skill, um jede Workflow-Definition gegen die aktuelle Vercel-Dokumentation zu prüfen. Stelle sicher, dass ein Workflow nur eine opaque Analyse-ID und keine Policy-Texte, API-Keys oder umfangreichen Retrieval-Pakete als dauerhaften Workflow-Input erhält.

Prüfe jeden Schritt auf Idempotenz, deterministische Wiederholung, begrenzte Payloads, Timeouts, Fehlerklassifikation und sichere Retries. Ein wiederholter Schritt darf keine doppelten Analyseergebnisse, Belegstellen, Audit-Events, Grant-Verbräuche oder Credential-Löschungen erzeugen. Nicht wiederholbare externe Modellaufrufe müssen durch persistierte Zustände oder eindeutige Idempotency-Grenzen geschützt sein.

Prüfe, ob das Zerlegen der Analyse auf einzelne regulatorische Anforderungen die Vercel-Grenzen für Laufzeit, Speicher, Funktionsgröße und Parallelität tatsächlich einhält. Untersuche, ob Concurrency-Limits, globale Kostenlimits, Tageslimits und Backpressure auch bei vielen gleichzeitigen Nutzern wirksam bleiben.

Prüfe alle Fehlerpfade. Eine fehlgeschlagene Vorverarbeitung, ein Provider-Timeout, eine ungültige strukturierte Antwort oder ein Verifikationsfehler muss in einem verständlichen persistierten Status enden. Workflows dürfen nicht dauerhaft in `queued` oder `running` verbleiben, ohne dass Monitoring und Recovery dies erkennen.

## KI-Pipeline und regulatorische Ergebnisqualität

Prüfe die KI-Infrastruktur mit dem Schwerpunkt auf der wichtigsten KPI: Es dürfen keine erfundenen Belegstellen akzeptiert werden und falsch-positive Erfüllungsbewertungen müssen minimiert werden. Prüfe Vorverarbeitung, Retrieval, Assessment, Verifikation und Finalisierung als getrennte Vertrauensgrenzen.

Stelle sicher, dass ausschließlich veröffentlichte und eingefrorene Rahmenwerk-Releases, ausgewählte Anforderungen, Institutsgröße, Unternehmenskontext, Policy-Version, Modellroute und versionierte Admin-Anweisungen in die Analyse eingehen. Eine spätere Änderung im Adminbereich darf ein bestehendes Ergebnis nicht stillschweigend verändern.

Prüfe das Retrieval darauf, ob es ausreichend hohe Recall-Werte erreicht, ohne unbeschränkte Dokumentteile an das Modell zu senden. Prüfe Chunking, Seiten- und Absatzlokatoren, Ranking, Tokenbudgets und den Umgang mit tabellarischen oder OCR-bedingt fehlerhaften Inhalten. Ein fehlender belastbarer Nachweis muss zu „Keine Einschätzung möglich“ oder einer entsprechend konservativen Bewertung führen und darf nicht durch Modellwissen ersetzt werden.

Prüfe die strukturierten Modellausgaben gegen strikte Schemata. Untersuche, ob unbekannte Statuswerte, fehlende Felder, zu lange Texte, unzulässige Zitate oder fehlerhafte Referenzen zuverlässig abgewiesen werden. Jede verwendete Belegstelle muss als exakter Substring in einem autoritativen Dokumentblock vorhanden sein und über Hash, Block-ID, Seite und Absatz zur eingefrorenen Policy-Version gehören.

Prüfe den separaten Verifikationsschritt. Der Verifier darf nicht lediglich die Formulierung des Assessors bestätigen, sondern muss Belegtreue, Statuslogik und regulatorische Abdeckung unabhängig prüfen. Kontrolliere, welche Risikofälle zwingend verifiziert werden, welche Ergebnisse automatisch zurückgewiesen werden und wie Konflikte zwischen Assessor und Verifier behandelt werden.

Untersuche Prompt-Injection-Risiken in Policy-Texten, OCR-Inhalten, Unternehmenskontexten, regulatorischen Texten und Chatfragen. Dokumentinhalt muss immer als nicht vertrauenswürdige Quelle behandelt werden und darf Systemanweisungen, Toolzugriffe, Providerwahl oder Ausgabeformat nicht verändern.

## Provider, BYOK und Datenschutzrouten

Prüfe die providerneutrale Umsetzung für Requesty, OpenRouter, Anthropic, Google und OpenAI. Verfolge die Modellwahl vom UI über den eingefrorenen Draft bis zum Workflow. Ein Nutzer darf nicht durch manipulierte Modell-IDs oder Providerfelder eine nicht erlaubte Route aktivieren.

Prüfe die Durchsetzung von EU-Verarbeitung und Zero Data Retention. Eine UI-Warnung oder Nutzerbestätigung ersetzt keine technische Routenkontrolle. Nicht evaluierte, aber technisch und datenschutzrechtlich kompatible Modelle dürfen auswählbar sein, müssen jedoch eindeutig markiert werden. Inkompatible Routen müssen serverseitig blockiert bleiben.

Prüfe Sponsored-Keys und Nutzer-Keys getrennt. Der Betreiber-Key darf ausschließlich aus serverseitigen Umgebungsvariablen gelesen werden. Ein Nutzer-Key darf niemals in Local Storage, Session Storage, URLs, Logs, Analytics, Workflow-Payloads, Fehlermeldungen oder Audit-Metadaten gelangen. Prüfe AES-256-GCM-Nutzung, Nonce-Erzeugung, Authentifizierungs-Tag, Key-Versionierung, Binding an Nutzer, Sitzung, Zweck und Analyse sowie die Löschung nach Abschluss und spätestens nach 24 Stunden.

Prüfe, ob die Credential-Validierung nur die erforderlichen Providerendpunkte aufruft und gegen SSRF, Weiterleitungen und manipulierte Base-URLs geschützt ist. Provider-Fehler dürfen keine Secrets oder vollständigen Upstream-Responses offenlegen.

## Caching und Wiederverwendung

Inventarisiere jeden Cache auf Browser-, Next.js-, Vercel-, Anwendungs- und Datenbankebene. Prüfe für jeden Cache-Key, ob mindestens alle fachlich relevanten Dimensionen enthalten sind. Dazu können Organisation, Nutzer, Policy-Hash, Parser-Version, Rahmenwerk-Release, Anforderungs-ID, Institutsgröße, Unternehmenskontext, Retrieval-Version, Prompt-Version, Modellprofil, Providerroute und Datenschutzprofil gehören.

Ein Cache darf niemals Ergebnisse, Retrieval-Pakete, Policy-Blöcke oder Chatkontext zwischen Organisationen teilen. Prüfe, ob private APIs konsequent `private, no-store` oder eine gleichwertig sichere Strategie verwenden. Untersuche Next.js- und CDN-Defaults ausdrücklich; verlasse dich nicht auf die Annahme, dass dynamische Authentifizierung automatisch jeden Cache verhindert.

Bewerte getrennt, welche Inhalte global und sicher wiederverwendbar sind. Veröffentlichte regulatorische Texte, unveränderliche Framework-Releases und öffentliche Modellmetadaten können andere Cache-Grenzen besitzen als Policies und Analyseergebnisse.

## Chat, Retrieval und Streaming

Prüfe den Chat als eigenen geschützten Bereich. In Version eins darf der Chat ausschließlich veröffentlichte regulatorische Rahmenwerke verwenden und keinen Policy-Kontext laden. Kontrolliere, ob eine fehlende Rahmenwerkauswahl tatsächlich zu einem begrenzten, verständlichen Verhalten führt.

Prüfe Thread-Eigentum, Organisationsbindung, Nachrichtenreihenfolge, Löschfristen, Retrieval-Quellen, Zitationsvalidierung und Streaming. Ein Nutzer darf keine fremden Threads über IDs fortsetzen oder lesen. Server-Sent Events müssen Abbrüche, Backpressure, Providerfehler und Client-Disconnects korrekt behandeln. Teilweise gestreamte Antworten dürfen nicht fälschlich als vollständig und zitierfähig gespeichert werden.

Prüfe, ob jede fachliche Aussage auf die ausgegebenen regulatorischen Quellen zurückgeführt werden kann. Das Modell darf keine nicht vorhandenen Quellen, Artikel oder Fundstellen erzeugen. Die Anwendung muss kenntlich machen, wenn die verfügbaren Quellen keine belastbare Antwort erlauben.

## API-Sicherheit und Missbrauchsschutz

Prüfe alle APIs auf Schema-Validierung, Request-Größen, Content-Type, sichere Fehlercodes, Origin-Prüfung, CSRF-Schutz, Rate Limits und Autorisierung. Untersuche, ob Proxy-Header wie `x-forwarded-for`, Host oder Protokoll nur aus vertrauenswürdigen Vercel-Grenzen verwendet werden. IP-Signale dürfen Missbrauchserkennung unterstützen, aber nicht den dauerhaften Gratisanspruch ersetzen.

Prüfe Turnstile als zusätzliche Hürde für Sponsored-Starts und gegebenenfalls Registrierung. Das Token muss serverseitig validiert, an Hostname und vorgesehene Aktion gebunden und gegen Wiederverwendung geschützt werden. Beurteile außerdem, wie sich die Anwendung verhält, wenn Turnstile nicht konfiguriert oder der Prüfdienst nicht erreichbar ist.

Suche nach SSRF, unsicheren Redirects, offenen Proxies, Path Traversal, SQL-Injection, unkontrollierten Regex-Ausdrücken, Prototype Pollution, unsicherer Deserialisierung, Formel-Injection im Excel-Export und Log-Injection. Prüfe Security Header, Content Security Policy, `frame-ancestors`, MIME-Sniffing-Schutz und Referrer Policy anhand der tatsächlichen Next.js-Konfiguration.

## Löschung, Aufbewahrung und Datenschutz

Verfolge die Löschung einer Policy vollständig durch Originaldatei, geparste Blöcke, OCR-Artefakte, Analyseergebnisse, Retrieval-Pakete, Cache-Einträge, temporäre Credentials, Chatdaten und Auditdaten. Das Originaldokument muss nach 24 Stunden gelöscht werden. Prüfe sowohl den primären Retention-Workflow als auch den Cron- beziehungsweise Recovery-Pfad.

Prüfe Account-Löschung und die fachlich notwendige Reihenfolge abhängiger Löschungen. Dokumentiere bewusst aufbewahrte Auditdaten und stelle sicher, dass sie keine Policy-Inhalte, API-Keys oder unnötigen personenbezogenen Daten enthalten. Unterscheide zwischen Löschung im aktiven System und möglichen Backup-Aufbewahrungen; behaupte keine sofortige physische Löschung aus Providerbackups, wenn diese nicht nachgewiesen ist.

## Administration und regulatorische Stammdaten

Prüfe, ob ausschließlich globale Administratoren Rahmenwerke, Releases, Anforderungen, Subanforderungen, Modellfreigaben und Analyseanweisungen verändern können. Veröffentlichte Releases und Anweisungen müssen unveränderlich oder sauber versioniert sein. Eine Analyse muss stets die genauen IDs, Versionen und Content-Hashes der verwendeten Grundlagen speichern.

Untersuche Veröffentlichungs-, Archivierungs- und Parallelitätsregeln. Zwei konkurrierende Admin-Requests dürfen keine widersprüchlichen aktiven Releases erzeugen. Audit-Events müssen Akteur, Ziel, Zeitpunkt und sichere Metadaten enthalten, ohne regulatorische Volltexte oder Secrets unnötig zu duplizieren.

## Beobachtbarkeit, Betrieb und Kostenkontrolle

Prüfe Health-Endpunkte, Workflow-Status, Heartbeats, strukturierte Logs, Fehlerkorrelation, Audit-Events und Alarmierungsgrundlagen. Logs müssen Analyse-ID, Workflow-ID und sichere Statusinformationen korrelieren können, ohne Policy-Inhalte, E-Mail-Adressen, Tokens oder API-Keys offenzulegen.

Prüfe, ob Administratoren festhängende, fehlgeschlagene und wiederholte Läufe erkennen können. Beurteile die Aussagekraft für Providerfehler, OCR-Fehler, Datenbankfehler, Blob-Fehler, Verifikationsfehler, Kostenlimit und Löschfehler.

Bewerte den Kostenpfad für eine Policy mit 40 Seiten und zehn Anforderungen. Identifiziere unnötige doppelte Modellaufrufe, wiederholtes Parsing, übergroße Prompts und unbeschränkte Retries. Kostenoptimierung darf jedoch niemals die Belegtreue, konservative Bewertung oder Verifikation schwächen.

## Abhängigkeiten, Lizenz und Lieferkette

Prüfe fest gepinnte Versionen, Lockfile, bekannte Schwachstellen, Installationsskripte, optionale Abhängigkeiten und den Umgang mit der Beta-Version von Neon Auth. Prüfe, ob die vorhandene `.pnpmfile.cjs`-Anpassung weiterhin erforderlich und sicher ist. Führe den vorhandenen Produktions-Audit aus, ohne automatische Updates oder Major-Upgrades einzuspielen.

Prüfe, ob Anwendungscode und Dokumentation die PolyForm-Noncommercial-Lizenz korrekt als source-available und nicht als OSI Open Source bezeichnen. Bewerte regulatorische Texte, Beispieldokumente, OCR-Daten, Modell-SDKs und sonstige Fremdinhalte auf dokumentierte Herkunft und Lizenzhinweise. Gib keine abschließende Rechtsberatung, sondern kennzeichne Punkte, die durch juristische Beratung bestätigt werden müssen.

## Tests und Nachweise

Ordne jedem kritischen Kontrollziel mindestens einen vorhandenen oder fehlenden Test zu. Erwarte Tests für Auth-Callbacks, Passwortregistrierung, Sessionübernahme, unbestätigte E-Mail, OAuth-Fehler, Draft-Claim, doppelte Starts, Sponsored-Grant, BYOK-Binding, Cross-Tenant-Zugriffe, Adminrollen, Uploadgrenzen, Parserfehler, Workflow-Retries, Zitatvalidierung, Prompt-Injection, Cache-Isolation, Chat-Ownership, Excel-Formeln und Löschung.

Cross-Tenant-Tests müssen mindestens zwei getrennte Nutzer und Organisationen verwenden. Sie müssen nachweisen, dass Nutzer B weder Status, Ergebnis, Dokument, Export, Chat, Credential noch Löschung von Nutzer A erreichen kann. Ein bloßer Unit-Test einer Rollenfunktion reicht dafür nicht aus.

Tests mit externen Providern müssen klar von deterministischen lokalen Tests getrennt sein. Nutze Mocks für reguläre CI-Läufe und dokumentiere gesonderte Smoke-Tests für Neon Auth, Vercel Workflow, Vercel Blob und die freigegebenen KI-Routen. Führe niemals kostenpflichtige Modelltests ohne ausdrückliche Zustimmung aus.

## Erwarteter Auditbericht

Speichere den Bericht als `docs/BACKEND_AUDIT.md`. Beginne mit einer knappen Entscheidung, ob das Backend aus technischer Sicht für die öffentliche Beta freigabefähig ist. Verwende genau eine der Aussagen „freigabefähig“, „freigabefähig mit Bedingungen“ oder „nicht freigabefähig“. Begründe die Entscheidung mit den wichtigsten nachgewiesenen Risiken.

Führe danach den geprüften Umfang, die verwendeten Skills, die ausgeführten Kommandos und alle nicht prüfbaren Bereiche auf. Dokumentiere jeden Befund mit einer stabilen ID wie `AUTH-001` oder `TENANT-001`, einer Schwereklasse, dem betroffenen Kontrollziel, konkreten Dateipfaden und Zeilennummern, einem reproduzierbaren Nachweis, der Auswirkung, der Ursache und einer präzisen Abhilfe.

Verwende die Schwereklassen `kritisch`, `hoch`, `mittel`, `niedrig` und `Hinweis`. Ein kritischer Befund setzt eine unmittelbar ausnutzbare Gefährdung von Mandantentrennung, Secrets, regulatorischer Ergebnisintegrität oder massenhafter Datenlöschung voraus. Ein hoher Befund beschreibt eine realistische erhebliche Gefährdung oder einen Go-live-Blocker. Vermeide übertriebene Schweregrade ohne nachvollziehbaren Angriffspfad.

Erstelle zusätzlich eine Kontrollmatrix mit mindestens den Bereichen Authentifizierung, Mandantentrennung, Upload, Workflow, KI-Grounding, BYOK, Caching, Löschung, Administration und Betrieb. Verwende pro Kontrolle einen der Zustände `bestanden`, `teilweise bestanden`, `nicht bestanden` oder `nicht verifiziert` und verlinke die zugehörigen Befunde und Tests.

Schließe den Bericht mit einer priorisierten Behebungsliste. Trenne zwingende Go-live-Blocker von Verbesserungen nach dem Beta-Start. Schätze die Umsetzung nicht in erfundenen Personentagen, sondern beschreibe Abhängigkeiten, Reihenfolge und erforderliche Verifikation. Nenne am Ende ausdrücklich alle Bereiche, die trotz Review nicht bewiesen werden konnten.

## Qualitätsregeln für deine Arbeit

Formuliere präzise und in vollständigen Sätzen. Behaupte nichts allein aufgrund eines Dateinamens, eines Kommentars oder einer UI-Beschriftung. Belege positive und negative Aussagen mit Code, Tests, Konfiguration oder aktueller Primärdokumentation. Kopiere keine Secrets, Tokens, vollständigen Policy-Texte oder personenbezogenen Daten in den Bericht.

Ignoriere das statische Verzeichnis `enterprise-wireframe/`, sofern es nicht von der produktiven Next.js-Anwendung importiert oder zur Laufzeit verwendet wird. Das Audit gilt dem produktiven Backend im Repository-Root. Ändere keine Designentscheidungen und führe keinen visuellen Frontend-Review durch, außer wenn eine Oberfläche fälschlich als einzige Sicherheitskontrolle verwendet wird.

Wenn du eine Unsicherheit durch lokale, sichere und reversible Prüfung beseitigen kannst, führe diese Prüfung aus. Wenn dafür externe Zugangsdaten, ein Deployment, eine kostenpflichtige KI-Anfrage oder eine irreversible Änderung erforderlich wäre, stoppe an dieser Stelle, dokumentiere den fehlenden Nachweis und frage den Nutzer gezielt um Erlaubnis. Liefere erst dann ein finales Urteil, wenn du den gesamten beschriebenen Prüfbereich bearbeitet und alle Befunde gegeneinander auf Konsistenz geprüft hast.
