// @vitest-environment node
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";

import { blocksFromDocumentHtml } from "@/domain/policies/document-structure";

import { buildDocx, ocrNoteText, pageMarkerPrefix } from "./build-docx";
import { extractPdfPages } from "./extract";
import {
  buildLines,
  isNumericCell,
  joinLines,
  layoutDocument,
  type PageInput,
  type PositionedItem,
} from "./layout";

type TextLine = { x: number; y: number; text: string; size?: number };

/**
 * Ein kleines, echtes PDF mit Helvetica-Text an festen Positionen — genug, um den
 * Weg pdfjs → Layout → Word → Aufbereitung zu prüfen, ohne Beispielberichte im
 * Repository.
 */
function makePdf(pages: TextLine[][]) {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const pagesId = objects.length + 1;
  objects.push("");
  const pageIds: number[] = [];
  for (const lines of pages) {
    const stream = lines
      .map(
        (line) =>
          `BT /F1 ${line.size ?? 10} Tf ${line.x} ${line.y} Td (${line.text
            .replace(/\\/gu, "\\\\")
            .replace(/\(/gu, "\\(")
            .replace(/\)/gu, "\\)")}) Tj ET`,
      )
      .join("\n");
    const content = add(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(output, "latin1"));
}

/** Eine Seite wie im gbs-Bericht: Kopfzeile, Randziffer, Absatz, Tabelle, Fußzeile. */
function reportPage(pageNumber: number): TextLine[] {
  return [
    { x: 256, y: 816, text: "Muster Wirtschaftsprüfung GmbH" },
    { x: 62, y: 740, text: "74" },
    {
      x: 90,
      y: 740,
      text: "Im Vergleich zum Vorjahr ergab sich im letzten Geschäftsjahr folgende",
    },
    { x: 90, y: 726, text: "Entwicklung der Ertragslage der Gesellschaft:" },
    { x: 290, y: 700, text: "2021", size: 9 },
    { x: 380, y: 700, text: "2020", size: 9 },
    { x: 90, y: 688, text: "Umsatzerlöse", size: 9 },
    { x: 295, y: 688, text: "4.416,4", size: 9 },
    { x: 380, y: 688, text: "12.734,0", size: 9 },
    { x: 90, y: 677, text: "Materialaufwand", size: 9 },
    { x: 300, y: 677, text: "951,2", size: 9 },
    { x: 385, y: 677, text: "790,0", size: 9 },
    { x: 90, y: 666, text: "Rohertrag", size: 9 },
    { x: 295, y: 666, text: "3.465,2", size: 9 },
    { x: 380, y: 666, text: "11.944,0", size: 9 },
    { x: 62, y: 630, text: "75" },
    { x: 90, y: 630, text: "Der Materialaufwand ist um TEUR 161 gestiegen." },
    { x: 62, y: 51, text: `Musterbericht - ${pageNumber} -`, size: 8 },
  ];
}

describe("layout heuristics", () => {
  it("recognizes numeric cells including malformed report formats", () => {
    for (const value of ["4.416,4", "-3.430", "34,04%", "(286.092,64)", "-", "1.344.989,.19"]) {
      expect(isNumericCell(value), value).toBe(true);
    }
    for (const value of ["31.12.2021", "4.", "Umsatzerlöse", "in EUR"]) {
      expect(isNumericCell(value), value).toBe(false);
    }
  });

  it("joins hyphenated words but keeps hyphens before conjunctions", () => {
    expect(joinLines("des Prüfungs-", "berichts")).toBe("des Prüfungsberichts");
    expect(joinLines("der Vermögens-", "und Ertragslage")).toBe("der Vermögens- und Ertragslage");
  });

  it("merges justified word fragments into one prose segment", () => {
    const words = ["Bei", "der", "Bewertung", "der", "Vermögensgegenstände", "und", "Schulden"];
    let x = 70;
    const items: PositionedItem[] = words.map((text) => {
      const item = { text, x, y: 500, width: text.length * 5, height: 11 };
      x += text.length * 5 + 14;
      return item;
    });
    const [line] = buildLines(items);
    expect(line!.segments).toHaveLength(1);
    expect(line!.segments[0]!.text).toBe(words.join(" "));
  });

  it("keeps numbers in their own columns and builds a table", () => {
    const page: PageInput = {
      pageNumber: 1,
      width: 595,
      height: 842,
      ocr: false,
      items: [
        { text: "31.12.2025", x: 300, y: 600, width: 40, height: 9 },
        { text: "31.12.2024", x: 400, y: 600, width: 40, height: 9 },
        { text: "Bis 3 Monate", x: 70, y: 588, width: 50, height: 9 },
        { text: "2.190,00", x: 305, y: 588, width: 35, height: 9 },
        { text: "0", x: 436, y: 588, width: 4, height: 9 },
        { text: "Summe", x: 70, y: 576, width: 30, height: 9 },
        { text: "774.391,78", x: 297, y: 576, width: 43, height: 9 },
        { text: "110.310,00", x: 397, y: 576, width: 43, height: 9 },
      ],
    };
    const table = layoutDocument([page]).find((node) => node.kind === "table");
    expect(table).toEqual({
      kind: "table",
      rows: [
        { cells: ["", "31.12.2025", "31.12.2024"], header: true },
        { cells: ["Bis 3 Monate", "2.190,00", "0"], header: false },
        { cells: ["Summe", "774.391,78", "110.310,00"], header: false },
      ],
    });
  });

  it("merges multi-line labels of detached number rows", () => {
    const page: PageInput = {
      pageNumber: 1,
      width: 595,
      height: 842,
      ocr: false,
      items: [
        { text: "2025", x: 300, y: 620, width: 18, height: 9 },
        { text: "2024", x: 400, y: 620, width: 18, height: 9 },
        { text: "1. Zinsen und ähnliche", x: 72, y: 600, width: 80, height: 9 },
        { text: "20.936.848,26", x: 270, y: 596, width: 48, height: 6.5 },
        { text: "30.518", x: 395, y: 596, width: 23, height: 6.5 },
        { text: "Erträge", x: 72, y: 589, width: 27, height: 9 },
        { text: "4. Provisionserträge", x: 72, y: 565, width: 73, height: 9 },
        { text: "2.489.484,42", x: 274, y: 572, width: 44, height: 6.5 },
        { text: "1.116", x: 400, y: 572, width: 18, height: 6.5 },
      ],
    };
    const table = layoutDocument([page]).find((node) => node.kind === "table");
    expect(table?.kind === "table" && table.rows.map((row) => row.cells)).toEqual([
      ["", "2025", "2024"],
      ["1. Zinsen und ähnliche Erträge", "20.936.848,26", "30.518"],
      ["4. Provisionserträge", "2.489.484,42", "1.116"],
    ]);
  });
});

describe("pdf to docx conversion", () => {
  it("turns a small PDF into Word with page markers, Tz paragraphs and real tables", async () => {
    const pdf = makePdf([reportPage(1), reportPage(2), reportPage(3)]);
    const pages = await extractPdfPages(pdf, { root: process.cwd() });
    expect(pages.every((page) => !page.ocr)).toBe(true);

    const nodes = layoutDocument(pages);
    const docx = await buildDocx(nodes, "Test");
    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(docx) });
    const blocks = blocksFromDocumentHtml(html);
    const texts = blocks.map((block) => block.text);

    expect(texts).toContain(`${pageMarkerPrefix}1`);
    expect(texts).toContain(`${pageMarkerPrefix}3`);
    expect(texts).not.toContain(ocrNoteText);
    // Kopf- und Fußzeilen stehen auf jeder Seite und fallen weg.
    expect(texts.some((text) => text.includes("Muster Wirtschaftsprüfung"))).toBe(false);
    expect(texts.some((text) => text.startsWith("Musterbericht"))).toBe(false);
    // Die Randziffer bleibt vor ihrem Absatz; der Zeilenumbruch ist aufgelöst.
    expect(texts).toContain(
      "74 Im Vergleich zum Vorjahr ergab sich im letzten Geschäftsjahr folgende Entwicklung der Ertragslage der Gesellschaft:",
    );
    const cells = blocks.filter((block) => block.kind === "table_cell").map((block) => block.text);
    // Nur die Jahreszeile ist Kopf; Wertezeilen bleiben normale Zellen.
    expect(html.match(/<th>/gu)?.length ?? 0).toBeLessThanOrEqual(3 * 3);
    expect(html).toContain("<td><p>4.416,4</p></td>");
    expect(cells).toEqual(
      expect.arrayContaining(["Umsatzerlöse", "4.416,4", "12.734,0", "Rohertrag", "3.465,2"]),
    );
  }, 60_000);
});
