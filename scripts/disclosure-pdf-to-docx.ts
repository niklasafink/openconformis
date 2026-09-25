/**
 * Lokales Werkzeug der Offenlegungspflicht: wandelt ein PDF ohne KI in eine Word-Datei
 * um, damit der Bereich nur einen Parserpfad (DOCX) kennt.
 *
 *   pnpm disclosure:pdf-to-docx <eingabe.pdf> <ausgabe.docx>
 *
 * Seiten mit Textebene liest pdfjs, gescannte Seiten die Texterkennung (deu+eng).
 * Tabellen werden echte Word-Tabellen, jede Seite beginnt mit „PDF-Seite n“.
 * Das Werkzeug läuft nur auf dem eigenen Rechner — nie im Upload-Pfad.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { buildDocx } from "../src/server/disclosure/pdf-conversion/build-docx";
import { extractPdfPages } from "../src/server/disclosure/pdf-conversion/extract";
import { layoutDocument } from "../src/server/disclosure/pdf-conversion/layout";

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || !output.toLowerCase().endsWith(".docx")) {
    console.error("Aufruf: pnpm disclosure:pdf-to-docx <eingabe.pdf> <ausgabe.docx>");
    process.exit(2);
  }
  const bytes = new Uint8Array(await readFile(resolve(input)));
  const pages = await extractPdfPages(bytes, {
    root: process.cwd(),
    onProgress: (message) => console.log(message),
  });
  const nodes = layoutDocument(pages);
  const docx = await buildDocx(nodes, basename(input).replace(/\.pdf$/iu, ""));
  await writeFile(resolve(output), docx);
  const ocrPages = pages.filter((page) => page.ocr).map((page) => page.pageNumber);
  const tables = nodes.filter((node) => node.kind === "table").length;
  console.log(
    `${pages.length} Seiten, ${tables} Tabellen` +
      (ocrPages.length ? `, Texterkennung auf Seite ${ocrPages.join(", ")}` : "") +
      ` → ${output}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
