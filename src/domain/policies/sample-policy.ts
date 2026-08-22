export type SamplePolicyBlock = Readonly<{
  id: string;
  kind: "title" | "heading" | "paragraph" | "list_item";
  text: string;
}>;

export const samplePolicy = {
  id: "musterbank-ikt-v3-2",
  filename: "Beispiel-IKT-Sicherheitsrichtlinie.docx",
  displayName: "Beispiel-IKT-Sicherheitsrichtlinie",
  language: "de",
  pageCount: 14,
  parserVersion: "sample-canonical-v1",
  provenanceNote:
    "Synthetisches Beispieldokument von Neura Labs UG (haftungsbeschränkt); keine echte Unternehmensrichtlinie.",
  reuseNotice: "Bereitgestellt unter CC BY-NC 4.0. Nur für Test- und Demonstrationszwecke.",
  blocks: [
    {
      id: "b1",
      kind: "title",
      text: "IKT-Sicherheitsrichtlinie der Musterbank AG",
    },
    {
      id: "b2",
      kind: "paragraph",
      text: "Dokumentenklassifizierung: Intern – Vertraulich. Versionsstand: 3.2. Verantwortlicher Bereich: Informationssicherheit (CISO-Office). Geltungsbereich: Diese Richtlinie gilt für alle Geschäftsbereiche, Mitarbeiterinnen und Mitarbeiter, Dienstleister sowie für sämtliche Informations- und Kommunikationstechnologie (IKT) der Musterbank AG.",
    },
    { id: "b3", kind: "heading", text: "1. Zweck und Zielsetzung" },
    {
      id: "b4",
      kind: "paragraph",
      text: "Die vorliegende IKT-Sicherheitsrichtlinie legt die verbindlichen Grundsätze und Mindestanforderungen für den sicheren Betrieb der Informations- und Kommunikationstechnologie der Musterbank AG fest. Ziel ist es, die Vertraulichkeit, Integrität, Verfügbarkeit und Authentizität von Daten und IKT-Systemen jederzeit zu gewährleisten und die operationale Widerstandsfähigkeit der Bank gegenüber IKT-bezogenen Störungen sicherzustellen. Die Richtlinie ist Bestandteil des übergeordneten IKT-Risikomanagementrahmens der Musterbank AG; die hierin geregelten Verfahren, Protokolle und Tools für die IKT-Sicherheit sind in diesen Rahmen eingebettet und werden mit den Prozessen der Informationssicherheit konsistent geführt. Zur Überwachung der Implementierung dieser Richtlinie werden folgende Indikatoren und Maßnahmen angewendet:",
    },
    {
      id: "b5",
      kind: "list_item",
      text: "Indikatoren: Regelmäßige Audits der IKT-Sicherheitsmaßnahmen, Überprüfung der Compliance-Quoten bei Schulungen, Anzahl der erkannten Sicherheitsvorfälle, Einhaltung von Patch-Management-Zyklen.",
    },
    {
      id: "b6",
      kind: "list_item",
      text: "Maßnahmen: Jährliche Überprüfung der Wirksamkeit der Richtlinie durch interne und externe Auditoren. Bei Abweichungen oder Ausnahmen von der Implementierung ist ein formeller Genehmigungsprozess durch den CISO erforderlich, der die Sicherstellung der digitalen operationalen Resilienz bewertet und dokumentiert.",
    },
    { id: "b7", kind: "heading", text: "2. Governance und Verantwortlichkeiten" },
    {
      id: "b8",
      kind: "paragraph",
      text: "Die IKT-Sicherheitsrichtlinie wurde durch die zuständigen Gremien der Musterbank AG verabschiedet und durch die Geschäftsleitung freigegeben. Datum der Genehmigung durch die Geschäftsleitung: [Datum der Genehmigung]. Die übergeordnete Verantwortung für die Informationssicherheit liegt beim Chief Information Security Officer (CISO), der unmittelbar an das für die IKT zuständige Mitglied des Vorstands berichtet.",
    },
    {
      id: "b9",
      kind: "list_item",
      text: "Der CISO verantwortet die Weiterentwicklung, Pflege und Durchsetzung dieser Richtlinie.",
    },
    {
      id: "b10",
      kind: "list_item",
      text: "Die Fachbereichsleitungen sind für die Umsetzung der Vorgaben in ihren jeweiligen Verantwortungsbereichen zuständig.",
    },
    {
      id: "b11",
      kind: "list_item",
      text: "Alle Mitarbeiterinnen und Mitarbeiter sind verpflichtet, die in dieser Richtlinie festgelegten Sicherheitsanforderungen einzuhalten; dies gilt auf allen Ebenen der Organisation vom Sachbearbeiter bis zur Geschäftsleitung.",
    },
    {
      id: "b12",
      kind: "list_item",
      text: "Die Aufgaben für die Entwicklung, Implementierung und Aufrechterhaltung der IKT-Sicherheitsmaßnahmen werden dem CISO-Office sowie dem IT-Betrieb zugewiesen.",
    },
    {
      id: "b13",
      kind: "paragraph",
      text: "Die Richtlinie wird regelmäßig durch das CISO-Office überprüft und bei Bedarf angepasst. Wesentliche Änderungen der rechtlichen Rahmenbedingungen oder der Cyberbedrohungslage werden im Rahmen dieser Überprüfung berücksichtigt.",
    },
    { id: "b14", kind: "heading", text: "2.1 Aufgabentrennung und Interessenkonflikte" },
    {
      id: "b15",
      kind: "paragraph",
      text: "Zur Vermeidung von Interessenkonflikten und zur Gewährleistung einer unabhängigen Kontrolle sind die Aufgaben nach dem Modell der drei Verteidigungslinien organisiert: Die erste Linie bilden der IT-Betrieb und die Fachbereiche als operativ verantwortliche Einheiten, die zweite Linie das CISO-Office gemeinsam mit dem Risikocontrolling, die dritte Linie die Interne Revision. Eine Personalunion zwischen operativer IKT-Verantwortung und Kontrollfunktion ist ausgeschlossen.",
    },
    { id: "b16", kind: "heading", text: "3. IKT-Risikomanagement" },
    {
      id: "b17",
      kind: "paragraph",
      text: "Der IKT-Risikomanagementrahmen der Musterbank AG ist dokumentiert, in das Gesamtrisikomanagementsystem der Bank integriert und wird mindestens einmal jährlich auf Angemessenheit und Wirksamkeit überprüft. Identifizierte IKT-Risiken werden bewertet, in das zentrale Risikoinventar überführt und mit Maßnahmen, Verantwortlichen und Fristen hinterlegt.",
    },
    { id: "b18", kind: "heading", text: "4. Schulung und Sensibilisierung" },
    {
      id: "b19",
      kind: "paragraph",
      text: "Alle Mitarbeiterinnen und Mitarbeiter durchlaufen bei Eintritt sowie danach jährlich eine verpflichtende Awareness-Schulung zu Informationssicherheit, Phishing und dem Umgang mit vertraulichen Daten. Die Teilnahmequote wird zentral erfasst und dem CISO-Office berichtet.",
    },
    { id: "b20", kind: "heading", text: "5. Zugriffsschutz und Identitätsmanagement" },
    {
      id: "b21",
      kind: "paragraph",
      text: "Der Zugriff auf IKT-Systeme und Daten erfolgt ausschließlich über ein rollenbasiertes Berechtigungsmodell nach dem Least-Privilege-Prinzip; Berechtigungen werden nur im tatsächlich erforderlichen Umfang vergeben. Für privilegierte Zugänge sowie für Fernzugriffe ist eine Mehr-Faktor-Authentisierung verpflichtend.",
    },
    {
      id: "b22",
      kind: "paragraph",
      text: "Vergebene Berechtigungen werden regelmäßig durch die jeweiligen Fachbereichsleitungen rezertifiziert. Nicht mehr benötigte Konten werden deaktiviert.",
    },
    { id: "b23", kind: "heading", text: "6. Erkennung und Überwachung" },
    {
      id: "b24",
      kind: "paragraph",
      text: "Sicherheitsrelevante Ereignisse aus IKT-Systemen, Netzwerkkomponenten und Anwendungen werden zentral in einem Security Information and Event Management (SIEM) protokolliert und durch ein rund um die Uhr besetztes Security Operations Center (SOC) ausgewertet.",
    },
    {
      id: "b25",
      kind: "paragraph",
      text: "Für sicherheitsrelevante Ereignisse sind Schwellenwerte und Alarmierungsregeln definiert; bei Überschreitung erfolgt eine unverzügliche Eskalation an das CISO-Office und, bei schwerwiegenden Vorfällen, an die Geschäftsleitung.",
    },
    { id: "b26", kind: "heading", text: "7. Auslagerungen und IKT-Drittdienstleister" },
    {
      id: "b27",
      kind: "paragraph",
      text: "IKT-Dienstleister werden vor Vertragsschluss einer Sicherheitsprüfung unterzogen. Vertraglich sind Mindestanforderungen an Informationssicherheit, Prüf- und Auditrechte sowie Meldepflichten bei Sicherheitsvorfällen zu vereinbaren. Sämtliche Auslagerungen werden in einem zentralen Auslagerungsregister geführt und jährlich überprüft.",
    },
    { id: "b28", kind: "heading", text: "8. Inkrafttreten" },
    {
      id: "b29",
      kind: "paragraph",
      text: "Diese Richtlinie tritt mit Freigabe durch die Geschäftsleitung in Kraft und ersetzt alle vorherigen Fassungen. Abweichungen bedürfen der schriftlichen Zustimmung des CISO.",
    },
  ] satisfies readonly SamplePolicyBlock[],
} as const;

export function getSamplePolicyCanonicalText() {
  return samplePolicy.blocks.map((block) => `${block.id}\t${block.kind}\t${block.text}`).join("\n");
}
