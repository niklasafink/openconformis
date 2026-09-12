import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docxMimeType, pdfMimeType } from "@/domain/policies/upload";

import { parsePolicyDocument } from "./document-parser";

describe("document parser", () => {
  it("parses the canonical sample DOCX into stable paragraphs", async () => {
    const bytes = await readFile(
      resolve(process.cwd(), "assets/samples/beispiel-ikt-sicherheitsrichtlinie.docx"),
    );
    const parsed = await parsePolicyDocument(bytes, docxMimeType);

    expect(parsed.detectedMimeType).toBe(docxMimeType);
    expect(parsed.needsOcr).toBe(false);
    expect(parsed.pageCount).toBeGreaterThan(0);
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(20);
    expect(parsed.blocks[0]?.text).toContain("IKT-Sicherheitsrichtlinie");
  });
});

/**
 * Ein minimales, gültiges PDF mit einer Textzeile. Selbst gebaut statt als
 * Binärdatei abgelegt: der Test soll das Auslesen prüfen, nicht eine Beilage
 * pflegen — und die Beispieldaten des Produkts gehören nicht in Tests.
 */
function createPdfWithLine(line: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 14 Tf 72 760 Td (${line}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

describe("PDF parsing", () => {
  it("extracts the text of a real PDF instead of failing on its worker", async () => {
    // Der Bundler verbog den Workerpfad von pdf.js; jedes PDF scheiterte dann
    // mit „Setting up fake worker failed" und landete als `failed` in der
    // Aufbereitung — sichtbar erst beim echten Upload, nie in der Typprüfung.
    const parsed = await parsePolicyDocument(
      createPdfWithLine("Das Leitungsorgan genehmigt den Rahmen"),
      pdfMimeType,
    );

    expect(parsed.detectedMimeType).toBe(pdfMimeType);
    expect(parsed.pageCount).toBe(1);
    expect(parsed.blocks.map((block) => block.text).join(" ")).toContain(
      "Das Leitungsorgan genehmigt den Rahmen",
    );

    // Unter Vitest fände pdf.js seinen Worker auch ohne Zutun — gebündelt nicht.
    // Deshalb wird hier festgehalten, dass der Parser den Pfad selbst setzt und
    // dass er auf eine wirklich vorhandene Datei zeigt.
    const { GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(GlobalWorkerOptions.workerSrc).toMatch(/pdf\.worker\.mjs$/u);
    await expect(stat(GlobalWorkerOptions.workerSrc)).resolves.toBeDefined();
  });
});
