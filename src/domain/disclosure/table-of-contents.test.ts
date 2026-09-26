import { describe, expect, it } from "vitest";

import { recognizeDates, recognizeDocumentDates } from "./dates";
import type { ContextInputBlock } from "./document-context";
import { recognizeFigures } from "./figures";
import { tableOfContentsBlockIds } from "./table-of-contents";

let sequence = 0;
function block(text: string, blockType = "paragraph"): ContextInputBlock {
  sequence += 1;
  return { id: `b${sequence}`, blockType, text };
}
function cell(text: string, row: number, column: number): ContextInputBlock {
  sequence += 1;
  return {
    id: `c${sequence}`,
    blockType: "table_cell",
    text,
    cell: { table: 3, row, column, header: false },
  };
}

const entries = [
  "Anlagenverzeichnis 3",
  "Prüfungsauftrag 4",
  "Grundsätzliche Feststellungen 4",
  "Stellungnahme zur Lagebeurteilung der gesetzlichen Vertreter 4",
  "Entwicklungsbeeinträchtigende oder bestandsgefährdende Tatsachen 6",
  "Wiedergabe des Bestätigungsvermerks 8",
  "Gegenstand, Art und Umfang der Prüfung 13",
  "Feststellungen und Erläuterungen zur Rechnungslegung 15",
  "Rechtliche und wirtschaftliche Verhältnisse 18",
  "Entwicklung im laufenden Geschäftsjahr 21",
  "Schlussbemerkung 22",
];

describe("tableOfContentsBlockIds", () => {
  it("covers the table of contents of an audit report, but not the text after it", () => {
    const title = block("Inhaltsverzeichnis", "heading");
    const page = block("Seite");
    const lines = entries.map((text) => block(text));
    const body = block("Die Mitarbeiterzahl beträgt 12");
    const ids = tableOfContentsBlockIds([block("PDF-Seite 2"), title, page, ...lines, body]);
    expect(ids.has(title.id)).toBe(true);
    expect(lines.every((line) => ids.has(line.id))).toBe(true);
    expect(ids.has(body.id)).toBe(false);
    // Die Seitenzahlen wären sonst Anzahlen.
    expect(recognizeFigures(entries[1]!, { blockType: "paragraph" })).toHaveLength(1);
  });

  it("finds a table of contents without its title by ascending page numbers", () => {
    const lines = entries.slice(0, 5).map((text) => block(text));
    const ids = tableOfContentsBlockIds([block("Bericht"), ...lines]);
    expect(lines.every((line) => ids.has(line.id))).toBe(true);
  });

  it("finds a table of contents in one block with line breaks", () => {
    const list = block(entries.join("\n"));
    expect(tableOfContentsBlockIds([list]).has(list.id)).toBe(true);
  });

  it("finds a table of contents converted into a table", () => {
    const cells = entries
      .slice(0, 6)
      .flatMap((text, row) => [
        cell(text.replace(/\s\d+$/u, ""), row, 0),
        cell(text.match(/\d+$/u)![0], row, 1),
      ]);
    const ids = tableOfContentsBlockIds(cells);
    expect(cells.every((entry) => ids.has(entry.id))).toBe(true);
  });

  it("leaves amounts and sentences that end in a number alone", () => {
    const blocks = [
      block("Umsatzerlöse TEUR 4.416"),
      block("Die Mitarbeiterzahl beträgt 12"),
      block("Der Aufsichtsrat tagte 4"),
      block("Anzahl der Sitzungen 3"),
    ];
    expect(tableOfContentsBlockIds(blocks).size).toBe(0);
  });
});

describe("recognizeDates", () => {
  it("reads written and numeric dates", () => {
    const text =
      "Die Gesellschafterversammlung vom 22. April 2021 hat den Vertrag vom 8.12.2021 und den Beschluss vom 3.5.21 gebilligt.";
    expect(recognizeDates(text).map(({ raw, iso }) => ({ raw, iso }))).toEqual([
      { raw: "22. April 2021", iso: "2021-04-22" },
      { raw: "8.12.2021", iso: "2021-12-08" },
      { raw: "3.5.21", iso: "2021-05-03" },
    ]);
  });

  it("skips the closing dates of the report and prior year and impossible dates", () => {
    const text =
      "Zum 31. Dezember 2021 (31.12.2020) und ab 1.1.2021; nicht 31.02.2021, wohl aber 31.12.2019.";
    expect(recognizeDates(text, { reportYear: 2021 }).map(({ iso }) => iso)).toEqual([
      "2019-12-31",
    ]);
  });

  it("does not read amounts, versions or statutes as dates", () => {
    expect(recognizeDates("TEUR 1.506 und 4.416,4 sowie § 321 Abs. 4a HGB, Version 1.2.3")).toEqual(
      [],
    );
  });

  it("skips dates in a table of contents and in column heads", () => {
    const title = block("Inhaltsverzeichnis");
    const lines = entries.slice(0, 4).map((text) => block(text));
    const dated = block("Bilanz zum 30. Juni 2021 5");
    const head = { ...block("30.06.2021"), header: true };
    const body = block("Beschluss vom 22. April 2021");
    const dates = recognizeDocumentDates([title, ...lines, dated, head, body], 2021);
    expect(dates.map((date) => date.blockId)).toEqual([body.id]);
  });
});
