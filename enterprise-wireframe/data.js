/* Mock-Daten für den Wireframe. Kein Backend, keine KI — alle Ergebnisse sind vorberechnet.
   Belegstellen (`ev`) referenzieren Block-IDs aus POLICY und einen wörtlichen Substring
   daraus. Der Substring muss exakt im Blocktext vorkommen — check.js prüft das. */

const FRAMEWORKS = [
  { id: 'dora', name: 'DORA', category: 'IT-Compliance', long: 'Verordnung (EU) 2022/2554', region: 'EU', subs: ['RTS (EU) 2024/1774', 'ITS (EU) 2024/2956'], requirementCount: 10, featured: true, seeded: true },
  { id: 'eu-aml', name: 'EU AML', category: 'Geldwäscheprävention', long: 'EU-Geldwäschepaket · AMLR und AMLD6', region: 'EU', subs: ['AMLR (EU) 2024/1624', 'AMLD6 (EU) 2024/1640'], requirementCount: 8, featured: true, seeded: false },
  { id: 'marisk', name: 'MaRisk', category: 'Risikomanagement', long: 'BaFin-Rundschreiben 05/2023 (BA)', region: 'DE', subs: ['AT 4.3', 'BT 3'], requirementCount: 9, featured: true, seeded: false },
  { id: 'aiact', name: 'EU AI Act', category: 'IT-Compliance', long: 'Verordnung (EU) 2024/1689', region: 'EU', subs: ['Harmonisierte Normen'], premium: true },
  { id: 'nis2', name: 'NIS2', category: 'IT-Compliance', long: 'Richtlinie (EU) 2022/2555', region: 'EU', subs: [], premium: true },
  { id: 'mica', name: 'MiCA', category: 'Finanzmarktregulierung', long: 'Verordnung (EU) 2023/1114', region: 'EU', subs: ['RTS/ITS-Paket'], premium: true },
  { id: 'csrd', name: 'CSRD / ESRS', category: 'Nachhaltigkeit', long: 'Richtlinie (EU) 2022/2464', region: 'EU', subs: ['ESRS Set 1'], premium: true },
  { id: 'dsgvo', name: 'DSGVO', category: 'Datenschutz', long: 'Verordnung (EU) 2016/679', region: 'EU', subs: ['EDSA-Leitlinien'], premium: true },
  { id: 'sfdr', name: 'SFDR', category: 'Nachhaltigkeit', long: 'Verordnung (EU) 2019/2088', region: 'EU', subs: ['RTS (EU) 2022/1288'], premium: true },
  { id: 'taxo', name: 'EU-Taxonomie', category: 'Nachhaltigkeit', long: 'Verordnung (EU) 2020/852', region: 'EU', subs: [], premium: true },
  { id: 'mifid', name: 'MiFID II / MiFIR', category: 'Finanzmarktregulierung', long: 'Richtlinie 2014/65/EU', region: 'EU', subs: ['Delegierte VO 2017/565'], premium: true },
  { id: 'mar', name: 'MAR', category: 'Finanzmarktregulierung', long: 'Verordnung (EU) 596/2014', region: 'EU', subs: [], premium: true },
  { id: 'emir', name: 'EMIR', category: 'Finanzmarktregulierung', long: 'Verordnung (EU) 648/2012', region: 'EU', subs: ['EMIR REFIT'], premium: true },
  { id: 'prospekt', name: 'Prospekt-VO', category: 'Finanzmarktregulierung', long: 'Verordnung (EU) 2017/1129', region: 'EU', subs: [], premium: true },
  { id: 'ssr', name: 'Leerverkaufs-VO', category: 'Finanzmarktregulierung', long: 'Verordnung (EU) 236/2012', region: 'EU', subs: [], premium: true },
  { id: 'crr', name: 'CRR III / CRD VI', category: 'Bankenaufsicht', long: 'Verordnung (EU) 2024/1623', region: 'EU', subs: ['EBA-Leitlinien'], premium: true },
  { id: 'psd', name: 'PSD2 → PSD3 / PSR', category: 'Zahlungsverkehr', long: 'Richtlinie (EU) 2015/2366', region: 'EU', subs: ['RTS SCA'], premium: true },
  { id: 'kwg', name: 'KWG', category: 'Bankenaufsicht', long: 'Kreditwesengesetz', region: 'DE', subs: [], premium: true },
  { id: 'zag', name: 'ZAG', category: 'Zahlungsverkehr', long: 'Zahlungsdiensteaufsichtsgesetz', region: 'DE', subs: [], premium: true }
];

/* Die Beispiel-Policy. Jeder Block hat eine stabile ID — Belegstellen hängen daran. */
const POLICY = [
  { id: 'b1',  k: 'h1', t: 'IKT-Sicherheitsrichtlinie der Musterbank AG' },
  { id: 'b2',  k: 'p',  t: 'Dokumentenklassifizierung: Intern – Vertraulich. Versionsstand: 3.2. Verantwortlicher Bereich: Informationssicherheit (CISO-Office). Geltungsbereich: Diese Richtlinie gilt für alle Geschäftsbereiche, Mitarbeiterinnen und Mitarbeiter, Dienstleister sowie für sämtliche Informations- und Kommunikationstechnologie (IKT) der Musterbank AG.' },
  { id: 'b3',  k: 'h2', t: '1. Zweck und Zielsetzung' },
  { id: 'b4',  k: 'p',  t: 'Die vorliegende IKT-Sicherheitsrichtlinie legt die verbindlichen Grundsätze und Mindestanforderungen für den sicheren Betrieb der Informations- und Kommunikationstechnologie der Musterbank AG fest. Ziel ist es, die Vertraulichkeit, Integrität, Verfügbarkeit und Authentizität von Daten und IKT-Systemen jederzeit zu gewährleisten und die operationale Widerstandsfähigkeit der Bank gegenüber IKT-bezogenen Störungen sicherzustellen. Die Richtlinie ist Bestandteil des übergeordneten IKT-Risikomanagementrahmens der Musterbank AG; die hierin geregelten Verfahren, Protokolle und Tools für die IKT-Sicherheit sind in diesen Rahmen eingebettet und werden mit den Prozessen der Informationssicherheit konsistent geführt. Zur Überwachung der Implementierung dieser Richtlinie werden folgende Indikatoren und Maßnahmen angewendet:' },
  { id: 'b5',  k: 'li', t: 'Indikatoren: Regelmäßige Audits der IKT-Sicherheitsmaßnahmen, Überprüfung der Compliance-Quoten bei Schulungen, Anzahl der erkannten Sicherheitsvorfälle, Einhaltung von Patch-Management-Zyklen.' },
  { id: 'b6',  k: 'li', t: 'Maßnahmen: Jährliche Überprüfung der Wirksamkeit der Richtlinie durch interne und externe Auditoren. Bei Abweichungen oder Ausnahmen von der Implementierung ist ein formeller Genehmigungsprozess durch den CISO erforderlich, der die Sicherstellung der digitalen operationalen Resilienz bewertet und dokumentiert.' },
  { id: 'b7',  k: 'h2', t: '2. Governance und Verantwortlichkeiten' },
  { id: 'b8',  k: 'p',  t: 'Die IKT-Sicherheitsrichtlinie wurde durch die zuständigen Gremien der Musterbank AG verabschiedet und durch die Geschäftsleitung freigegeben. Datum der Genehmigung durch die Geschäftsleitung: [Datum der Genehmigung]. Die übergeordnete Verantwortung für die Informationssicherheit liegt beim Chief Information Security Officer (CISO), der unmittelbar an das für die IKT zuständige Mitglied des Vorstands berichtet.' },
  { id: 'b9',  k: 'li', t: 'Der CISO verantwortet die Weiterentwicklung, Pflege und Durchsetzung dieser Richtlinie.' },
  { id: 'b10', k: 'li', t: 'Die Fachbereichsleitungen sind für die Umsetzung der Vorgaben in ihren jeweiligen Verantwortungsbereichen zuständig.' },
  { id: 'b11', k: 'li', t: 'Alle Mitarbeiterinnen und Mitarbeiter sind verpflichtet, die in dieser Richtlinie festgelegten Sicherheitsanforderungen einzuhalten; dies gilt auf allen Ebenen der Organisation vom Sachbearbeiter bis zur Geschäftsleitung.' },
  { id: 'b12', k: 'li', t: 'Die Aufgaben für die Entwicklung, Implementierung und Aufrechterhaltung der IKT-Sicherheitsmaßnahmen werden dem CISO-Office sowie dem IT-Betrieb zugewiesen.' },
  { id: 'b13', k: 'p',  t: 'Die Richtlinie wird regelmäßig durch das CISO-Office überprüft und bei Bedarf angepasst. Wesentliche Änderungen der rechtlichen Rahmenbedingungen oder der Cyberbedrohungslage werden im Rahmen dieser Überprüfung berücksichtigt.' },
  { id: 'b14', k: 'h3', t: '2.1 Aufgabentrennung und Interessenkonflikte' },
  { id: 'b15', k: 'p',  t: 'Zur Vermeidung von Interessenkonflikten und zur Gewährleistung einer unabhängigen Kontrolle sind die Aufgaben nach dem Modell der drei Verteidigungslinien organisiert: Die erste Linie bilden der IT-Betrieb und die Fachbereiche als operativ verantwortliche Einheiten, die zweite Linie das CISO-Office gemeinsam mit dem Risikocontrolling, die dritte Linie die Interne Revision. Eine Personalunion zwischen operativer IKT-Verantwortung und Kontrollfunktion ist ausgeschlossen.' },
  { id: 'b16', k: 'h2', t: '3. IKT-Risikomanagement' },
  { id: 'b17', k: 'p',  t: 'Der IKT-Risikomanagementrahmen der Musterbank AG ist dokumentiert, in das Gesamtrisikomanagementsystem der Bank integriert und wird mindestens einmal jährlich auf Angemessenheit und Wirksamkeit überprüft. Identifizierte IKT-Risiken werden bewertet, in das zentrale Risikoinventar überführt und mit Maßnahmen, Verantwortlichen und Fristen hinterlegt.' },
  { id: 'b18', k: 'h2', t: '4. Schulung und Sensibilisierung' },
  { id: 'b19', k: 'p',  t: 'Alle Mitarbeiterinnen und Mitarbeiter durchlaufen bei Eintritt sowie danach jährlich eine verpflichtende Awareness-Schulung zu Informationssicherheit, Phishing und dem Umgang mit vertraulichen Daten. Die Teilnahmequote wird zentral erfasst und dem CISO-Office berichtet.' },
  { id: 'b20', k: 'h2', t: '5. Zugriffsschutz und Identitätsmanagement' },
  { id: 'b21', k: 'p',  t: 'Der Zugriff auf IKT-Systeme und Daten erfolgt ausschließlich über ein rollenbasiertes Berechtigungsmodell nach dem Least-Privilege-Prinzip; Berechtigungen werden nur im tatsächlich erforderlichen Umfang vergeben. Für privilegierte Zugänge sowie für Fernzugriffe ist eine Mehr-Faktor-Authentisierung verpflichtend.' },
  { id: 'b22', k: 'p',  t: 'Vergebene Berechtigungen werden regelmäßig durch die jeweiligen Fachbereichsleitungen rezertifiziert. Nicht mehr benötigte Konten werden deaktiviert.' },
  { id: 'b23', k: 'h2', t: '6. Erkennung und Überwachung' },
  { id: 'b24', k: 'p',  t: 'Sicherheitsrelevante Ereignisse aus IKT-Systemen, Netzwerkkomponenten und Anwendungen werden zentral in einem Security Information and Event Management (SIEM) protokolliert und durch ein rund um die Uhr besetztes Security Operations Center (SOC) ausgewertet.' },
  { id: 'b25', k: 'p',  t: 'Für sicherheitsrelevante Ereignisse sind Schwellenwerte und Alarmierungsregeln definiert; bei Überschreitung erfolgt eine unverzügliche Eskalation an das CISO-Office und, bei schwerwiegenden Vorfällen, an die Geschäftsleitung.' },
  { id: 'b26', k: 'h2', t: '7. Auslagerungen und IKT-Drittdienstleister' },
  { id: 'b27', k: 'p',  t: 'IKT-Dienstleister werden vor Vertragsschluss einer Sicherheitsprüfung unterzogen. Vertraglich sind Mindestanforderungen an Informationssicherheit, Prüf- und Auditrechte sowie Meldepflichten bei Sicherheitsvorfällen zu vereinbaren. Sämtliche Auslagerungen werden in einem zentralen Auslagerungsregister geführt und jährlich überprüft.' },
  { id: 'b28', k: 'h2', t: '8. Inkrafttreten' },
  { id: 'b29', k: 'p',  t: 'Diese Richtlinie tritt mit Freigabe durch die Geschäftsleitung in Kraft und ersetzt alle vorherigen Fassungen. Abweichungen bedürfen der schriftlichen Zustimmung des CISO.' }
];

/* status: 'erfuellt' | 'teilweise' | 'nicht' */
const REQUIREMENTS = [
  {
    id: 'a1', cite: 'Art. 5 Abs. 2 DORA', title: 'Governance- und Kontrollrahmen',
    legal: 'Das Leitungsorgan des Finanzunternehmens legt alle Vorkehrungen im Zusammenhang mit dem IKT-Risikomanagementrahmen fest, genehmigt sie, überwacht ihre Umsetzung und ist für sie verantwortlich.',
    aspects: ['Festlegung durch das Leitungsorgan', 'Dokumentierte Genehmigung', 'Laufende Überwachung der Umsetzung', 'Letztverantwortung'],
    status: 'teilweise',
    reason: 'Die Richtlinie weist die übergeordnete Verantwortung für die Informationssicherheit dem CISO zu und regelt eine direkte Berichtslinie an das zuständige Vorstandsmitglied [[1]]. Eine Freigabe durch die Geschäftsleitung ist vorgesehen, das Genehmigungsdatum ist im Dokument jedoch nicht ausgefüllt [[2]] — die Genehmigung ist damit nicht nachweisbar dokumentiert. Eine über die Freigabe hinausgehende laufende Überwachung der Umsetzung durch das Leitungsorgan selbst wird nicht beschrieben; die Überprüfung ist ausschließlich dem CISO-Office zugewiesen [[3]].',
    ev: [
      { b: 'b8',  s: 'Die übergeordnete Verantwortung für die Informationssicherheit liegt beim Chief Information Security Officer (CISO), der unmittelbar an das für die IKT zuständige Mitglied des Vorstands berichtet.', loc: 'Abschnitt 2, Absatz 1' },
      { b: 'b8',  s: 'Datum der Genehmigung durch die Geschäftsleitung: [Datum der Genehmigung].', loc: 'Abschnitt 2, Absatz 1' },
      { b: 'b13', s: 'Die Richtlinie wird regelmäßig durch das CISO-Office überprüft und bei Bedarf angepasst.', loc: 'Abschnitt 2, Absatz 3' }
    ],
    subs: [{
      id: 'a1s1', cite: 'RTS (EU) 2024/1774 Art. 2', title: 'Elemente der IKT-Sicherheitsrichtlinien',
      legal: 'Die Finanzunternehmen nehmen in die IKT-Sicherheitsrichtlinien, -verfahren, -protokolle und -Tools mindestens die Elemente auf, die den Geltungsbereich, die Rollen und Verantwortlichkeiten, den Überprüfungszyklus sowie die Verknüpfung mit den Zielen der Geschäftsstrategie betreffen.',
      status: 'teilweise',
      reason: 'Geltungsbereich, Rollen und Verantwortlichkeiten sowie ein Überprüfungszyklus sind benannt [[1]]. Die zusätzlich geforderte Verknüpfung der Richtlinie mit den Zielen der Geschäftsstrategie des Unternehmens wird an keiner Stelle hergestellt.',
      ev: [{ b: 'b2', s: 'Geltungsbereich: Diese Richtlinie gilt für alle Geschäftsbereiche, Mitarbeiterinnen und Mitarbeiter, Dienstleister', loc: 'Kopfangaben' }]
    }]
  },
  {
    id: 'a2', cite: 'Art. 5 Abs. 4 DORA', title: 'Schulung des Leitungsorgans zu IKT-Risiken',
    legal: 'Die Mitglieder des Leitungsorgans des Finanzunternehmens halten aktiv ausreichende Kenntnisse und Fähigkeiten auf dem neuesten Stand, auch durch regelmäßige spezifische Schulungen, um die IKT-Risiken und deren Auswirkungen auf den Betrieb des Finanzunternehmens zu verstehen und zu bewerten; dies gilt in einem Umfang, der den zu steuernden IKT-Risiken angemessen ist.',
    aspects: ['Adressat Leitungsorgan', 'Regelmäßigkeit', 'IKT-spezifischer Inhalt', 'Nachweis der Teilnahme'],
    status: 'nicht',
    reason: 'Abschnitt 4 regelt verpflichtende Awareness-Schulungen ausdrücklich nur für Mitarbeiterinnen und Mitarbeiter [[1]]. Die Governance-Abschnitte verpflichten das Leitungsorgan zwar auf die Einhaltung der Richtlinie [[2]], sehen aber keine regelmäßigen, IKT-spezifischen Schulungen für Mitglieder des Leitungsorgans vor. Weder Umfang, Turnus noch Nachweis solcher Schulungen sind geregelt.',
    ev: [
      { b: 'b19', s: 'Alle Mitarbeiterinnen und Mitarbeiter durchlaufen bei Eintritt sowie danach jährlich eine verpflichtende Awareness-Schulung zu Informationssicherheit, Phishing und dem Umgang mit vertraulichen Daten.', loc: 'Abschnitt 4, Absatz 1' },
      { b: 'b11', s: 'dies gilt auf allen Ebenen der Organisation vom Sachbearbeiter bis zur Geschäftsleitung', loc: 'Abschnitt 2, Aufzählung' }
    ],
    subs: []
  },
  {
    id: 'a3', cite: 'Art. 6 Abs. 1 DORA', title: 'IKT-Risikomanagementrahmen',
    legal: 'Die Finanzunternehmen verfügen über einen soliden, umfassenden und gut dokumentierten IKT-Risikomanagementrahmen als Teil ihres Gesamtrisikomanagementsystems, der es ihnen ermöglicht, IKT-Risiken schnell, effizient und umfassend anzugehen und ein hohes Niveau der digitalen operationalen Resilienz zu gewährleisten.',
    aspects: ['Dokumentierter Rahmen', 'Integration in das Gesamtrisikomanagement', 'Umfassende Abdeckung', 'Wirksamkeit'],
    status: 'erfuellt',
    reason: 'Die Richtlinie ist ausdrücklich als Bestandteil des übergeordneten IKT-Risikomanagementrahmens ausgewiesen; ihre Verfahren, Protokolle und Tools sind in diesen Rahmen eingebettet [[1]]. Abschnitt 3 beschreibt den Rahmen als dokumentiert und in das Gesamtrisikomanagementsystem integriert, einschließlich Bewertung, Risikoinventar und Maßnahmenverfolgung mit Verantwortlichen und Fristen [[2]]. Die Anforderung ist damit abgedeckt.',
    ev: [
      { b: 'b4',  s: 'Die Richtlinie ist Bestandteil des übergeordneten IKT-Risikomanagementrahmens der Musterbank AG; die hierin geregelten Verfahren, Protokolle und Tools für die IKT-Sicherheit sind in diesen Rahmen eingebettet', loc: 'Abschnitt 1, Absatz 1' },
      { b: 'b17', s: 'Der IKT-Risikomanagementrahmen der Musterbank AG ist dokumentiert, in das Gesamtrisikomanagementsystem der Bank integriert', loc: 'Abschnitt 3, Absatz 1' }
    ],
    subs: [{
      id: 'a3s1', cite: 'RTS (EU) 2024/1774 Art. 3', title: 'Allgemeine Elemente des IKT-Sicherheitsrahmens',
      legal: 'Die Finanzunternehmen nehmen in ihren IKT-Sicherheitsrahmen Verfahren zur Ermittlung, Bewertung und Behandlung von IKT-Risiken auf und stellen deren Nachverfolgung sicher.',
      status: 'erfuellt',
      reason: 'Ermittlung, Bewertung, Überführung in das Risikoinventar sowie die Nachverfolgung über Maßnahmen, Verantwortliche und Fristen sind ausdrücklich geregelt [[1]].',
      ev: [{ b: 'b17', s: 'Identifizierte IKT-Risiken werden bewertet, in das zentrale Risikoinventar überführt und mit Maßnahmen, Verantwortlichen und Fristen hinterlegt.', loc: 'Abschnitt 3, Absatz 1' }]
    }]
  },
  {
    id: 'a4', cite: 'Art. 6 Abs. 4 DORA', title: 'Kontrollfunktion und Aufgabentrennung',
    legal: 'Finanzunternehmen weisen die Verantwortung für die Verwaltung und Überwachung des IKT-Risikos einer Kontrollfunktion zu und stellen ein angemessenes Maß an Unabhängigkeit dieser Kontrollfunktion sicher, um Interessenkonflikte zu vermeiden. Sie gewährleisten eine angemessene Trennung und Unabhängigkeit von IKT-Risikomanagementfunktionen, Kontrollfunktionen und internen Auditfunktionen.',
    aspects: ['Benannte Kontrollfunktion', 'Unabhängigkeit', 'Vermeidung von Interessenkonflikten', 'Trennung von der Revision'],
    status: 'erfuellt',
    reason: 'Abschnitt 2.1 organisiert die Aufgaben nach dem Modell der drei Verteidigungslinien und trennt operativen IT-Betrieb, CISO-Office/Risikocontrolling und Interne Revision voneinander [[1]]. Eine Personalunion zwischen operativer IKT-Verantwortung und Kontrollfunktion ist ausdrücklich ausgeschlossen [[2]]. Die Unabhängigkeit der Kontrollfunktion wird zusätzlich durch die direkte Berichtslinie des CISO an den Vorstand gestützt [[3]].',
    ev: [
      { b: 'b15', s: 'sind die Aufgaben nach dem Modell der drei Verteidigungslinien organisiert', loc: 'Abschnitt 2.1' },
      { b: 'b15', s: 'Eine Personalunion zwischen operativer IKT-Verantwortung und Kontrollfunktion ist ausgeschlossen.', loc: 'Abschnitt 2.1' },
      { b: 'b8',  s: 'der unmittelbar an das für die IKT zuständige Mitglied des Vorstands berichtet', loc: 'Abschnitt 2, Absatz 1' }
    ],
    subs: []
  },
  {
    id: 'a5', cite: 'Art. 6 Abs. 5 DORA', title: 'Überprüfung des Risikomanagementrahmens',
    legal: 'Der IKT-Risikomanagementrahmen wird mindestens einmal jährlich, bei Kleinstunternehmen in regelmäßigen Abständen, sowie beim Auftreten schwerwiegender IKT-bezogener Vorfälle und nach aufsichtsrechtlichen Anweisungen oder Feststellungen aus einschlägigen Tests der digitalen operationalen Resilienz oder Auditverfahren überprüft.',
    aspects: ['Jährlicher Turnus', 'Anlassbezogene Überprüfung nach Vorfällen', 'Aufsichtliche Anweisungen', 'Auditfeststellungen'],
    status: 'teilweise',
    reason: 'Der jährliche Überprüfungsturnus ist an zwei Stellen verankert — als Wirksamkeitsprüfung durch interne und externe Auditoren [[1]] sowie als jährliche Angemessenheitsprüfung des Rahmenwerks [[2]]. Berücksichtigt werden dabei Änderungen der Rechtslage und der Bedrohungslage [[3]]. Nicht geregelt ist die zusätzlich geforderte anlassbezogene Überprüfung beim Auftreten schwerwiegender IKT-bezogener Vorfälle sowie nach aufsichtsrechtlichen Anweisungen.',
    ev: [
      { b: 'b6',  s: 'Jährliche Überprüfung der Wirksamkeit der Richtlinie durch interne und externe Auditoren.', loc: 'Abschnitt 1, Aufzählung' },
      { b: 'b17', s: 'wird mindestens einmal jährlich auf Angemessenheit und Wirksamkeit überprüft', loc: 'Abschnitt 3, Absatz 1' },
      { b: 'b13', s: 'Wesentliche Änderungen der rechtlichen Rahmenbedingungen oder der Cyberbedrohungslage werden im Rahmen dieser Überprüfung berücksichtigt.', loc: 'Abschnitt 2, Absatz 3' }
    ],
    subs: []
  },
  {
    id: 'a6', cite: 'Art. 8 Abs. 1 DORA', title: 'Identifizierung und Klassifizierung von IKT-Assets',
    legal: 'Im Rahmen des in Artikel 6 Absatz 1 genannten IKT-Risikomanagementrahmens ermitteln, klassifizieren und dokumentieren Finanzunternehmen angemessen alle IKT-gestützten Unternehmensfunktionen, Rollen und Verantwortlichkeiten, die Informationsassets und IKT-Assets, die diese Funktionen unterstützen, sowie deren Rollen und Abhängigkeiten in Bezug auf die IKT-Risiken.',
    aspects: ['IKT-Asset-Register', 'Kritikalitätsklassifizierung', 'Dokumentation von Konfigurationen', 'Abhängigkeiten und Verbindungen'],
    status: 'nicht',
    reason: 'Die Richtlinie benennt IKT-Systeme nur pauschal im Geltungsbereich [[1]] und als Schutzobjekt der Sicherheitsziele [[2]]. Ein Verfahren zur Ermittlung, Klassifizierung und Dokumentation von IKT-gestützten Unternehmensfunktionen und IKT-Assets ist nicht beschrieben. Es fehlen insbesondere ein IKT-Asset-Register, eine Kritikalitätsklassifizierung sowie die Dokumentation von Konfigurationen und Abhängigkeiten.',
    ev: [
      { b: 'b2', s: 'sowie für sämtliche Informations- und Kommunikationstechnologie (IKT) der Musterbank AG', loc: 'Kopfangaben' },
      { b: 'b4', s: 'die Vertraulichkeit, Integrität, Verfügbarkeit und Authentizität von Daten und IKT-Systemen jederzeit zu gewährleisten', loc: 'Abschnitt 1, Absatz 1' }
    ],
    subs: [
      {
        id: 'a6s1', cite: 'RTS (EU) 2024/1774 Art. 4', title: 'Richtlinie für das Management von IKT-Assets',
        legal: '(1) Die Finanzunternehmen entwickeln, dokumentieren und implementieren im Rahmen der in Artikel 9 Absatz 2 der Verordnung (EU) 2022/2554 genannten IKT-Sicherheitsrichtlinien, -verfahren, -protokolle und -Tools eine Richtlinie für das Management von IKT-Assets.',
        status: 'nicht',
        reason: 'Es gibt keinen Abschnitt, der sich mit der Entwicklung, Dokumentation oder Implementierung einer Richtlinie für das Management von IKT-Assets befasst. Der Verweis auf die Einbettung in den IKT-Risikomanagementrahmen [[1]] adressiert Verfahren, Protokolle und Tools nur allgemein, nicht jedoch das Asset-Management.',
        ev: [{ b: 'b4', s: 'die hierin geregelten Verfahren, Protokolle und Tools für die IKT-Sicherheit sind in diesen Rahmen eingebettet', loc: 'Abschnitt 1, Absatz 1' }]
      },
      {
        id: 'a6s2', cite: 'RTS (EU) 2024/1774 Art. 5', title: 'Verfahren für das Management von IKT-Assets',
        legal: 'Die Finanzunternehmen entwickeln, dokumentieren und implementieren ein Verfahren für das Management von IKT-Assets, mit dem sie IKT-Assets erfassen, klassifizieren und deren Eigentümer festlegen.',
        status: 'nicht',
        reason: 'Ein Verfahren zur Erfassung, Klassifizierung und regelmäßigen Aktualisierung des IKT-Asset-Bestands einschließlich der Zuordnung von Eigentümern ist im Dokument nicht enthalten. Es konnte keine Textstelle als Beleg herangezogen werden.',
        ev: []
      }
    ]
  },
  {
    id: 'a7', cite: 'Art. 9 Abs. 4 lit. c DORA', title: 'Zugangs- und Zugriffsrechte',
    legal: 'Zur Verwirklichung der in Absatz 3 genannten Ziele setzen Finanzunternehmen Strategien um, die den physischen und virtuellen Zugang zu IKT-Systemressourcen und Daten auf das beschränken, was für rechtmäßige und zulässige Funktionen und Tätigkeiten erforderlich ist, und zu diesem Zweck Zugangsrechte verwalten, Verfahren zur Rechtevergabe festlegen und diese Rechte regelmäßig überprüfen.',
    aspects: ['Least-Privilege-Prinzip', 'Starke Authentisierung', 'Regelmäßige Rezertifizierung', 'Physischer Zugang'],
    status: 'teilweise',
    reason: 'Der virtuelle Zugriff ist über ein rollenbasiertes Berechtigungsmodell nach dem Least-Privilege-Prinzip geregelt [[1]], flankiert durch eine verpflichtende Mehr-Faktor-Authentisierung für privilegierte Zugänge und Fernzugriffe [[2]]. Eine Rezertifizierung ist vorgesehen, jedoch ohne verbindlichen Zyklus und ohne Eskalationsweg bei ausbleibender Bestätigung [[3]]. Der ebenfalls geforderte physische Zugang zu IKT-Systemressourcen wird im Dokument nicht adressiert.',
    ev: [
      { b: 'b21', s: 'ein rollenbasiertes Berechtigungsmodell nach dem Least-Privilege-Prinzip; Berechtigungen werden nur im tatsächlich erforderlichen Umfang vergeben', loc: 'Abschnitt 5, Absatz 1' },
      { b: 'b21', s: 'Für privilegierte Zugänge sowie für Fernzugriffe ist eine Mehr-Faktor-Authentisierung verpflichtend.', loc: 'Abschnitt 5, Absatz 1' },
      { b: 'b22', s: 'Vergebene Berechtigungen werden regelmäßig durch die jeweiligen Fachbereichsleitungen rezertifiziert.', loc: 'Abschnitt 5, Absatz 2' }
    ],
    subs: [{
      id: 'a7s1', cite: 'RTS (EU) 2024/1774 Art. 21', title: 'Verwaltung von Zugangsrechten',
      legal: 'Die Finanzunternehmen überprüfen die Zugangsrechte und passen sie an, wenn sich die Aufgaben eines Nutzers ändern oder das Beschäftigungsverhältnis endet; die Überprüfung erfolgt in regelmäßigen, risikoorientiert festgelegten Abständen.',
      status: 'teilweise',
      reason: 'Rezertifizierung und Deaktivierung nicht mehr benötigter Konten sind geregelt [[1]]. Ein risikoorientiert festgelegtes Überprüfungsintervall — etwa ein kürzerer Zyklus für privilegierte Konten — ist nicht bestimmt.',
      ev: [{ b: 'b22', s: 'Nicht mehr benötigte Konten werden deaktiviert.', loc: 'Abschnitt 5, Absatz 2' }]
    }]
  },
  {
    id: 'a8', cite: 'Art. 10 Abs. 1 DORA', title: 'Erkennung anomaler Aktivitäten',
    legal: 'Finanzunternehmen verfügen über Mechanismen, um anomale Aktivitäten gemäß Artikel 17 zu erkennen, einschließlich Problemen bei der Leistung von IKT-Netzwerken und IKT-bezogenen Vorfällen, und um potenzielle einzelne wesentliche Schwachstellen zu ermitteln.',
    aspects: ['Zentrale Protokollierung', 'Kontinuierliche Auswertung', 'Alarmierungsschwellen', 'Eskalationsweg'],
    status: 'erfuellt',
    reason: 'Abschnitt 6 beschreibt eine zentrale Protokollierung sicherheitsrelevanter Ereignisse aus Systemen, Netzwerkkomponenten und Anwendungen in einem SIEM sowie deren Auswertung durch ein durchgehend besetztes SOC [[1]]. Schwellenwerte, Alarmierungsregeln und ein definierter Eskalationsweg an CISO-Office und Geschäftsleitung sind festgelegt [[2]]. Die Anforderung ist damit abgedeckt.',
    ev: [
      { b: 'b24', s: 'werden zentral in einem Security Information and Event Management (SIEM) protokolliert und durch ein rund um die Uhr besetztes Security Operations Center (SOC) ausgewertet', loc: 'Abschnitt 6, Absatz 1' },
      { b: 'b25', s: 'Für sicherheitsrelevante Ereignisse sind Schwellenwerte und Alarmierungsregeln definiert; bei Überschreitung erfolgt eine unverzügliche Eskalation an das CISO-Office', loc: 'Abschnitt 6, Absatz 2' }
    ],
    subs: [{
      id: 'a8s1', cite: 'RTS (EU) 2024/1774 Art. 23', title: 'Protokollierung',
      legal: 'Die Finanzunternehmen legen fest, welche Ereignisse zu protokollieren sind, und stellen sicher, dass die Protokolle vor unbefugtem Zugriff und Veränderung geschützt sind.',
      status: 'erfuellt',
      reason: 'Die zu protokollierenden Quellen sind benannt und die Protokollierung erfolgt zentral in einem SIEM [[1]], womit die Trennung von den protokollierenden Systemen gegeben ist.',
      ev: [{ b: 'b24', s: 'Sicherheitsrelevante Ereignisse aus IKT-Systemen, Netzwerkkomponenten und Anwendungen', loc: 'Abschnitt 6, Absatz 1' }]
    }]
  },
  {
    id: 'a9', cite: 'Art. 11 Abs. 1 DORA', title: 'IKT-Geschäftsfortführungsleitlinie',
    legal: 'Im Rahmen des in Artikel 6 Absatz 1 genannten IKT-Risikomanagementrahmens verfügen Finanzunternehmen über eine umfassende IKT-Geschäftsfortführungsleitlinie, die als eigenständige spezifische Leitlinie und als fester Bestandteil der allgemeinen Geschäftsfortführungsleitlinie des Finanzunternehmens umgesetzt werden kann.',
    aspects: ['Eigenständige Leitlinie', 'Wiederanlaufziele (RTO/RPO)', 'Notfallpläne', 'Testturnus'],
    status: 'teilweise',
    reason: 'Die Richtlinie verweist auf die Sicherstellung der digitalen operationalen Resilienz im Rahmen des Ausnahmegenehmigungsprozesses [[1]] und benennt Verfügbarkeit als Schutzziel [[2]]. Eine IKT-Geschäftsfortführungsleitlinie mit Wiederanlaufzielen, Notfallplänen und Testturnus ist im vorliegenden Dokument selbst nicht enthalten.',
    ev: [
      { b: 'b6', s: 'der die Sicherstellung der digitalen operationalen Resilienz bewertet und dokumentiert', loc: 'Abschnitt 1, Aufzählung' },
      { b: 'b4', s: 'die operationale Widerstandsfähigkeit der Bank gegenüber IKT-bezogenen Störungen sicherzustellen', loc: 'Abschnitt 1, Absatz 1' }
    ],
    subs: []
  },
  {
    id: 'a10', cite: 'Art. 28 Abs. 1 DORA', title: 'Management des IKT-Drittparteienrisikos',
    legal: 'Finanzunternehmen steuern das Risiko im Zusammenhang mit IKT-Drittdienstleistern als integralen Bestandteil des IKT-Risikos innerhalb ihres IKT-Risikomanagementrahmens und im Einklang mit den Grundsätzen der Verhältnismäßigkeit unter Berücksichtigung von Art, Umfang, Komplexität und Bedeutung IKT-bezogener Abhängigkeiten.',
    aspects: ['Einbindung in den IKT-Risikorahmen', 'Vorvertragliche Prüfung', 'Vertragliche Mindestanforderungen', 'Informationsregister', 'Verhältnismäßigkeit'],
    status: 'teilweise',
    reason: 'Der Geltungsbereich bezieht Dienstleister ausdrücklich ein [[1]]. Abschnitt 7 fordert eine Sicherheitsprüfung vor Vertragsschluss sowie vertragliche Mindestanforderungen, Prüf- und Auditrechte und Meldepflichten [[2]] und schreibt ein zentrales, jährlich überprüftes Auslagerungsregister vor [[3]]. Nicht hergestellt ist die geforderte Verankerung des IKT-Drittparteienrisikos als integraler Bestandteil des IKT-Risikomanagementrahmens; ebenso fehlt eine Verhältnismäßigkeitsbetrachtung nach Art, Umfang und Kritikalität der Abhängigkeit.',
    ev: [
      { b: 'b2',  s: 'Dienstleister sowie für sämtliche Informations- und Kommunikationstechnologie', loc: 'Kopfangaben' },
      { b: 'b27', s: 'IKT-Dienstleister werden vor Vertragsschluss einer Sicherheitsprüfung unterzogen. Vertraglich sind Mindestanforderungen an Informationssicherheit, Prüf- und Auditrechte sowie Meldepflichten bei Sicherheitsvorfällen zu vereinbaren.', loc: 'Abschnitt 7, Absatz 1' },
      { b: 'b27', s: 'Sämtliche Auslagerungen werden in einem zentralen Auslagerungsregister geführt und jährlich überprüft.', loc: 'Abschnitt 7, Absatz 1' }
    ],
    subs: [{
      id: 'a10s1', cite: 'ITS (EU) 2024/2956 Art. 3', title: 'Informationsregister',
      legal: 'Die Finanzunternehmen führen ein Informationsregister zu allen vertraglichen Vereinbarungen über die Nutzung von IKT-Dienstleistungen, das die im Anhang festgelegten Vorlagen und Angaben umfasst.',
      status: 'teilweise',
      reason: 'Ein zentrales Auslagerungsregister mit jährlicher Überprüfung existiert [[1]]. Der von den ITS-Vorlagen geforderte Datenumfang — insbesondere Funktionskennungen, Vertragsdaten und Angaben zu Unterauftragnehmern — ist im Dokument nicht spezifiziert.',
      ev: [{ b: 'b27', s: 'in einem zentralen Auslagerungsregister geführt und jährlich überprüft', loc: 'Abschnitt 7, Absatz 1' }]
    }]
  }
];

/* Voreinstellungen für die Demo: eine Anforderung ist ausgesteuert, eine hat Best-Practice-Kontext. */
const SCOPE_DEFAULTS = {
  a9: { applicable: false, reason: 'Geschäftsfortführung ist in der separaten BCM-Richtlinie (BCM-RL 2.4) geregelt und nicht Gegenstand dieser IKT-Sicherheitsrichtlinie.' },
  a1: { bp: 'Leitungsorgan im Sinne von DORA ist bei uns der Gesamtvorstand; das IKT-Mandat liegt beim COO-Ressort. Genehmigungen von Richtlinien werden im Vorstandsbeschlussregister (VBR) dokumentiert, nicht im Dokument selbst.' }
};

const STATUS = {
  erfuellt:  { label: 'Erfüllt',            fg: '#1E9E6B', bg: '#E6F7EF' },
  teilweise: { label: 'Teilweise erfüllt',  fg: '#D98F1E', bg: '#FDF3E1' },
  nicht:     { label: 'Nicht erfüllt',      fg: '#DC3E3E', bg: '#FCEAEA' },
  na:        { label: 'Nicht einschlägig',  fg: '#9198A9', bg: '#F1F2F6' }
};

if (typeof module !== 'undefined') module.exports = { FRAMEWORKS, POLICY, REQUIREMENTS, SCOPE_DEFAULTS, STATUS };
