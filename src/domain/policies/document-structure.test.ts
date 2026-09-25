import { describe, expect, it } from "vitest";

import {
  blocksFromDocumentHtml,
  blocksFromPdfPages,
  locatedBlocksFromDocumentHtml,
  numberedHeadingLevel,
  outlineBlocks,
  pdfLinesFromText,
  type PdfLine,
} from "./document-structure";

describe("numbered headings", () => {
  it("reads the level from the numbering and rejects numbered sentences", () => {
    expect(numberedHeadingLevel("2. Governance und Verantwortlichkeiten")).toBe(1);
    expect(numberedHeadingLevel("2.1 Aufgabentrennung und Interessenkonflikte")).toBe(2);
    expect(numberedHeadingLevel("1. Der CISO genehmigt jede Ausnahme.")).toBeNull();
    expect(numberedHeadingLevel("Zweck und Zielsetzung")).toBeNull();
  });
});

describe("Word structure", () => {
  it("keeps headings, list items, table cells and their section", () => {
    const blocks = outlineBlocks(
      blocksFromDocumentHtml(
        '<h1 class="title">Richtlinie</h1>' +
          "<h1>1. Zweck</h1><p>Die Richtlinie gilt &amp; bindet.</p>" +
          "<p><strong>2.1 Aufgabentrennung</strong></p>" +
          "<ul><li>Erster Punkt</li><li>Zweiter<br />Punkt</li></ul>" +
          "<table><tr><td><p>Rolle</p></td><td><p>CISO</p></td></tr></table>",
      ),
    );

    expect(blocks).toEqual([
      { kind: "heading", text: "Richtlinie", level: 0, headingPath: [] },
      { kind: "heading", text: "1. Zweck", level: 1, headingPath: ["Richtlinie"] },
      {
        kind: "paragraph",
        text: "Die Richtlinie gilt & bindet.",
        headingPath: ["Richtlinie", "1. Zweck"],
      },
      {
        kind: "heading",
        text: "2.1 Aufgabentrennung",
        level: 2,
        headingPath: ["Richtlinie", "1. Zweck"],
      },
      {
        kind: "list_item",
        text: "Erster Punkt",
        headingPath: ["Richtlinie", "1. Zweck", "2.1 Aufgabentrennung"],
      },
      {
        kind: "list_item",
        text: "Zweiter Punkt",
        headingPath: ["Richtlinie", "1. Zweck", "2.1 Aufgabentrennung"],
      },
      {
        kind: "table_cell",
        text: "Rolle",
        headingPath: ["Richtlinie", "1. Zweck", "2.1 Aufgabentrennung"],
      },
      {
        kind: "table_cell",
        text: "CISO",
        headingPath: ["Richtlinie", "1. Zweck", "2.1 Aufgabentrennung"],
      },
    ]);
  });

  it("closes a section when a heading of the same level follows", () => {
    const blocks = outlineBlocks(
      blocksFromDocumentHtml("<h1>1. Zweck</h1><p>A</p><h1>2. Governance</h1><p>B</p>"),
    );
    expect(blocks.at(-1)).toMatchObject({ text: "B", headingPath: ["2. Governance"] });
  });
});

describe("PDF structure", () => {
  it("joins text runs into lines and splits lines at a change of baseline", () => {
    expect(
      pdfLinesFromText([
        { text: "Das Leitungsorgan", x: 72, width: 90, y: 700, height: 11, endOfLine: false },
        { text: "genehmigt", x: 166, width: 50, y: 700, height: 11, endOfLine: false },
        { text: "den Rahmen", x: 72, width: 55, y: 686, height: 11, endOfLine: true },
        { text: "", x: 0, width: 0, y: 0, height: 0, endOfLine: true },
      ]),
    ).toEqual([
      { text: "Das Leitungsorgan genehmigt", y: 700, height: 11 },
      { text: "den Rahmen", y: 686, height: 11 },
    ]);
  });

  it("keeps ligatures that pdf.js emits as separate runs inside their word", () => {
    // Chromium und Word setzen „fi" als eigene Glyphe; pdf.js liefert sie als
    // lückenlos anschließendes Textstück. Mit Leerzeichen verbunden stand dort
    // „Dokumentenklassi fi zierung".
    expect(
      pdfLinesFromText([
        { text: "Dokumentenklassi", x: 6, width: 89.8, y: 803.9, height: 11, endOfLine: false },
        { text: "fi", x: 95.8, width: 5.5, y: 803.9, height: 11, endOfLine: false },
        { text: "zierung: Intern", x: 101.3, width: 70, y: 803.9, height: 11, endOfLine: true },
      ]).map((line) => line.text),
    ).toEqual(["Dokumentenklassifizierung: Intern"]);
  });

  it("separates headings, paragraphs and list items and drops page numbers", () => {
    const line = (text: string, y: number, height = 11): PdfLine => ({ text, y, height });
    const blocks = outlineBlocks(
      blocksFromPdfPages([
        [
          line("IKT-Sicherheitsrichtlinie", 780, 18),
          line("1. Governance", 740),
          line("Das Leitungsorgan trägt die", 720),
          line("Verantwortung für den Rahmen.", 706),
          line("Es berichtet jährlich.", 680),
          line("• Erster Punkt mit", 660),
          line("Fortsetzung", 646),
          line("Seite 1 von 2", 40),
        ],
        [line("Fortsetzung auf Seite zwei.", 780)],
      ]),
    );

    expect(blocks.map(({ kind, text, pageNumber }) => ({ kind, text, pageNumber }))).toEqual([
      { kind: "heading", text: "IKT-Sicherheitsrichtlinie", pageNumber: 1 },
      { kind: "heading", text: "1. Governance", pageNumber: 1 },
      {
        kind: "paragraph",
        text: "Das Leitungsorgan trägt die Verantwortung für den Rahmen.",
        pageNumber: 1,
      },
      { kind: "paragraph", text: "Es berichtet jährlich.", pageNumber: 1 },
      { kind: "list_item", text: "• Erster Punkt mit Fortsetzung", pageNumber: 1 },
      { kind: "paragraph", text: "Fortsetzung auf Seite zwei.", pageNumber: 2 },
    ]);
    expect(blocks[2]?.headingPath).toEqual(["1. Governance"]);
  });
});

describe("locatedBlocksFromDocumentHtml", () => {
  it("keeps the block order of blocksFromDocumentHtml and adds table positions", () => {
    const html =
      "<p>Vorab</p><table><tr><th></th><th>2021</th><th>2020</th></tr>" +
      "<tr><td>Umsatzerlöse</td><td>4.416,4</td><td>12.734,0</td></tr>" +
      '<tr><td colspan="2">Summe</td><td>1,0</td></tr></table><p>Danach</p>';
    const located = locatedBlocksFromDocumentHtml(html);
    expect(located.map(({ cell: _cell, ...block }) => block)).toEqual(blocksFromDocumentHtml(html));
    expect(located.filter((block) => block.cell).map((block) => [block.text, block.cell])).toEqual([
      ["2021", { table: 0, row: 0, column: 1, header: true }],
      ["2020", { table: 0, row: 0, column: 2, header: true }],
      ["Umsatzerlöse", { table: 0, row: 1, column: 0, header: false }],
      ["4.416,4", { table: 0, row: 1, column: 1, header: false }],
      ["12.734,0", { table: 0, row: 1, column: 2, header: false }],
      ["Summe", { table: 0, row: 2, column: 0, header: false }],
      ["1,0", { table: 0, row: 2, column: 2, header: false }],
    ]);
  });
});
