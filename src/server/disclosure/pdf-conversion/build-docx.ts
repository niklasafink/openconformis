/**
 * Dokumentmodell → Word-Datei mit der MIT-lizenzierten Bibliothek `docx`. Tabellen
 * werden echte Word-Tabellen, damit die Aufbereitung sie als `table_cell`-Blöcke
 * liest. Jede PDF-Seite beginnt mit einem Marker-Absatz „PDF-Seite n“; die Erkennung
 * der Offenlegungspflicht liest daraus die Seitenzahl und wertet ihn nicht als Zahl.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { isNumericCell, type DocumentNode } from "./layout";

export const pageMarkerPrefix = "PDF-Seite ";
export const ocrNoteText = "per Texterkennung gelesen";

const headingLevels = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
] as const;

const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: "BFC4CC" };

function tableNode(rows: Extract<DocumentNode, { kind: "table" }>["rows"]) {
  const width = Math.max(...rows.map((row) => row.cells.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: thinBorder,
      bottom: thinBorder,
      left: thinBorder,
      right: thinBorder,
      insideHorizontal: thinBorder,
      insideVertical: thinBorder,
    },
    rows: rows.map(
      (row) =>
        new TableRow({
          tableHeader: row.header,
          children: Array.from({ length: width }, (_, index) => {
            const text = row.cells[index] ?? "";
            const numeric = index > 0 && isNumericCell(text);
            return new TableCell({
              width: {
                size: index === 0 ? 40 : 60 / Math.max(1, width - 1),
                type: WidthType.PERCENTAGE,
              },
              children: [
                new Paragraph({
                  alignment: numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: [new TextRun({ text, bold: row.header })],
                }),
              ],
            });
          }),
        }),
    ),
  });
}

export function buildDocxChildren(nodes: readonly DocumentNode[]) {
  const children: Array<Paragraph | Table> = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "pageMarker":
        children.push(
          new Paragraph({
            style: "PdfPageMarker",
            children: [new TextRun({ text: `${pageMarkerPrefix}${node.page}` })],
          }),
        );
        break;
      case "ocrNote":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: ocrNoteText, italics: true, color: "6B7280" })],
          }),
        );
        break;
      case "heading":
        children.push(
          new Paragraph({
            heading: headingLevels[node.level - 1] ?? HeadingLevel.HEADING_4,
            text: node.text,
          }),
        );
        break;
      case "listItem":
        children.push(new Paragraph({ text: node.text, bullet: { level: 0 } }));
        break;
      case "paragraph":
        children.push(new Paragraph({ text: node.text }));
        break;
      case "table":
        children.push(tableNode(node.rows));
        // Word verlangt nach einer Tabelle einen Absatz, sonst verschmelzen zwei
        // aufeinanderfolgende Tabellen zu einer.
        children.push(new Paragraph({ text: "" }));
        break;
    }
  }
  return children;
}

export async function buildDocx(nodes: readonly DocumentNode[], title: string) {
  const document = new Document({
    creator: "OpenConformis disclosure:pdf-to-docx",
    title,
    description: "Lokal ohne KI aus einem PDF erzeugt.",
    styles: {
      paragraphStyles: [
        {
          id: "PdfPageMarker",
          name: "PdfPageMarker",
          basedOn: "Normal",
          run: { size: 16, color: "9CA3AF" },
          paragraph: { spacing: { before: 240, after: 60 } },
        },
      ],
    },
    sections: [{ children: buildDocxChildren(nodes) }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}
