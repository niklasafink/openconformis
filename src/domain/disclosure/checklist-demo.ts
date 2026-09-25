import type { ChecklistItemInput } from "./checklist";

/**
 * Die einzige mitgelieferte Vorlage, bis der Betreiber die erste echte Checkliste
 * importiert: eine kleine, klar als Demo markierte Auswahl von Angabepflichten nach HGB
 * für Anhang und Lagebericht einer Kapitalgesellschaft. Eigene Kurzfassungen der
 * Pflichten, kein Gesetzeszitat und kein Ersatz für eine vollständige Anhangcheckliste.
 */

export const demoChecklistTemplate = {
  key: "hgb-anhang-lagebericht-kapg-demo",
  title: "HGB-Anhang und Lagebericht Kapitalgesellschaft (Demo)",
  classification: "demo" as const,
  provenanceNote:
    "Eigene Kurzfassung ausgewählter Angabepflichten nach §§ 284, 285 und 289 HGB (Stand 2026) für Demonstration und Tests. Keine vollständige Anhangcheckliste.",
  reuseNotice:
    "Eigene Zusammenstellung unter CC BY-NC 4.0. Der Gesetzeswortlaut selbst ist ein amtliches Werk (§ 5 UrhG).",
};

const item = (
  displayOrder: number,
  externalKey: string,
  reference: string,
  title: string,
  requirement: string,
  aspects: string[],
  parentKey: string | null = null,
): ChecklistItemInput => ({
  externalKey,
  reference,
  title,
  requirement,
  aspects,
  parentKey,
  displayOrder,
});

export const demoChecklistItems: readonly ChecklistItemInput[] = [
  item(
    1,
    "HGB-284-2-1",
    "§ 284 Abs. 2 Nr. 1 HGB",
    "Bilanzierungs- und Bewertungsmethoden",
    "Der Anhang gibt die auf die Posten der Bilanz und der Gewinn- und Verlustrechnung angewandten Bilanzierungs- und Bewertungsmethoden an.",
    [
      "Methoden für Anlagevermögen, Umlaufvermögen, Rückstellungen und Verbindlichkeiten genannt",
      "Abschreibungsmethoden und Nutzungsdauern",
    ],
  ),
  item(
    2,
    "HGB-284-2-2",
    "§ 284 Abs. 2 Nr. 2 HGB",
    "Abweichungen von Bilanzierungs- und Bewertungsmethoden",
    "Abweichungen von Bilanzierungs- und Bewertungsmethoden werden angegeben und begründet; ihr Einfluss auf die Vermögens-, Finanz- und Ertragslage wird gesondert dargestellt.",
    ["Abweichung benannt oder Stetigkeit ausdrücklich bestätigt", "Begründung", "Auswirkung"],
  ),
  item(
    3,
    "HGB-284-3",
    "§ 284 Abs. 3 HGB",
    "Entwicklung des Anlagevermögens",
    "Im Anhang ist die Entwicklung der einzelnen Posten des Anlagevermögens darzustellen, ausgehend von den gesamten Anschaffungs- und Herstellungskosten, mit Zugängen, Abgängen, Umbuchungen und Zuschreibungen sowie den Abschreibungen.",
    ["Anlagenspiegel vorhanden", "Abschreibungen des Geschäftsjahres gesondert"],
  ),
  item(
    4,
    "HGB-285-1",
    "§ 285 Nr. 1 HGB",
    "Langfristige und gesicherte Verbindlichkeiten",
    "Anzugeben sind der Gesamtbetrag der Verbindlichkeiten mit einer Restlaufzeit von mehr als fünf Jahren und der Gesamtbetrag der durch Pfandrechte oder ähnliche Rechte gesicherten Verbindlichkeiten unter Angabe von Art und Form der Sicherheiten.",
    [
      "Restlaufzeit über fünf Jahre",
      "Gesicherte Verbindlichkeiten mit Art und Form der Sicherheit",
    ],
  ),
  item(
    5,
    "HGB-285-3",
    "§ 285 Nr. 3 HGB",
    "Nicht in der Bilanz enthaltene Geschäfte",
    "Art und Zweck sowie Risiken, Vorteile und finanzielle Auswirkungen von nicht in der Bilanz enthaltenen Geschäften sind anzugeben, soweit sie für die Beurteilung der Finanzlage notwendig sind.",
    ["Geschäfte benannt oder ausdrücklich verneint", "Risiken und Vorteile"],
  ),
  item(
    6,
    "HGB-285-7",
    "§ 285 Nr. 7 HGB",
    "Zahl der Arbeitnehmer",
    "Anzugeben ist die durchschnittliche Zahl der während des Geschäftsjahres beschäftigten Arbeitnehmer, getrennt nach Gruppen.",
    ["Durchschnittszahl", "Gliederung nach Gruppen"],
  ),
  item(
    7,
    "HGB-285-9",
    "§ 285 Nr. 9 HGB",
    "Bezüge der Organmitglieder",
    "Für die Mitglieder des Geschäftsführungsorgans, eines Aufsichtsrats, eines Beirats oder einer ähnlichen Einrichtung sind jeweils für jede Personengruppe die Bezüge und Vorschüsse anzugeben.",
    ["Je Personengruppe getrennt"],
  ),
  item(
    1,
    "HGB-285-9-A",
    "§ 285 Nr. 9 Buchst. a HGB",
    "Gesamtbezüge des Geschäftsjahres",
    "Anzugeben sind die für die Tätigkeit im Geschäftsjahr gewährten Gesamtbezüge (Gehälter, Gewinnbeteiligungen, Bezugsrechte und sonstige aktienbasierte Vergütungen, Aufwandsentschädigungen, Versicherungsentgelte, Provisionen und Nebenleistungen jeder Art).",
    ["Betrag je Organ", "Hinweis auf Unterlassen nach § 286 Abs. 4 HGB, falls genutzt"],
    "HGB-285-9",
  ),
  item(
    2,
    "HGB-285-9-C",
    "§ 285 Nr. 9 Buchst. c HGB",
    "Vorschüsse und Kredite",
    "Anzugeben sind die gewährten Vorschüsse und Kredite unter Angabe der Zinssätze, der wesentlichen Bedingungen und der gegebenenfalls im Geschäftsjahr zurückgezahlten oder erlassenen Beträge sowie die zugunsten dieser Personen eingegangenen Haftungsverhältnisse.",
    ["Zinssätze und Bedingungen", "Haftungsverhältnisse"],
    "HGB-285-9",
  ),
  item(
    8,
    "HGB-285-10",
    "§ 285 Nr. 10 HGB",
    "Mitglieder der Organe",
    "Alle Mitglieder des Geschäftsführungsorgans und eines Aufsichtsrats sind mit dem Familiennamen und mindestens einem ausgeschriebenen Vornamen, einschließlich des ausgeübten Berufs, anzugeben; der Vorsitzende eines Aufsichtsrats und seine Stellvertreter sind als solche zu bezeichnen.",
    ["Namen und Beruf", "Vorsitz gekennzeichnet"],
  ),
  item(
    9,
    "HGB-285-17",
    "§ 285 Nr. 17 HGB",
    "Honorar des Abschlussprüfers",
    "Das vom Abschlussprüfer für das Geschäftsjahr berechnete Gesamthonorar ist aufgeschlüsselt anzugeben in Abschlussprüfungsleistungen, andere Bestätigungsleistungen, Steuerberatungsleistungen und sonstige Leistungen, soweit die Angaben nicht in einem Konzernabschluss enthalten sind.",
    ["Aufschlüsselung in vier Kategorien", "Verweis auf Konzernabschluss, falls genutzt"],
  ),
  item(
    10,
    "HGB-285-33",
    "§ 285 Nr. 33 HGB",
    "Vorgänge nach dem Abschlussstichtag",
    "Vorgänge von besonderer Bedeutung, die nach dem Schluss des Geschäftsjahres eingetreten und weder in der Gewinn- und Verlustrechnung noch in der Bilanz berücksichtigt sind, sind unter Angabe ihrer Art und ihrer finanziellen Auswirkungen anzugeben.",
    ["Vorgänge benannt oder ausdrücklich verneint", "Finanzielle Auswirkungen"],
  ),
  item(
    11,
    "HGB-285-34",
    "§ 285 Nr. 34 HGB",
    "Ergebnisverwendung",
    "Anzugeben ist der Vorschlag für die Verwendung des Ergebnisses oder der Beschluss über seine Verwendung.",
    ["Vorschlag oder Beschluss"],
  ),
  item(
    12,
    "HGB-289-1",
    "§ 289 Abs. 1 HGB",
    "Lagebericht: Geschäftsverlauf, Lage, Chancen und Risiken",
    "Im Lagebericht sind der Geschäftsverlauf einschließlich des Geschäftsergebnisses und die Lage der Kapitalgesellschaft so darzustellen, dass ein den tatsächlichen Verhältnissen entsprechendes Bild vermittelt wird; er enthält eine Analyse mit den bedeutsamsten finanziellen Leistungsindikatoren und beurteilt die voraussichtliche Entwicklung mit ihren wesentlichen Chancen und Risiken.",
    [
      "Geschäftsverlauf und Lage",
      "Finanzielle Leistungsindikatoren",
      "Prognose, Chancen und Risiken",
    ],
  ),
];
