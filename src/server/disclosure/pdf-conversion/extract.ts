/**
 * Liest ein PDF für das lokale Konverter-Werkzeug: Textstücke mit Position je Seite
 * über pdfjs, Seiten ohne Textebene über die Texterkennung (tesseract.js, deu+eng,
 * wie `src/server/worker/serverless-ocr.ts`). Keine KI, kein Netzwerk.
 */
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PageInput, PositionedItem } from "./layout";

/** Weniger Zeichen als hier gilt eine Seite als gescannt. */
const suspiciousTextCharacters = 250;
const ocrScale = 2.5;

type PdfTextItem = { str?: string; transform?: number[]; width?: number; height?: number };

function positionedFromPdf(item: PdfTextItem): PositionedItem | null {
  if (typeof item.str !== "string" || !item.transform) return null;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  const height =
    item.height && item.height > 0 ? item.height : Math.hypot(c, d) || Math.hypot(a, b);
  return { text: item.str, x: e, y: f, width: item.width ?? 0, height };
}

async function prepareLanguageDirectory(root: string) {
  const directory = await mkdtemp(join(tmpdir(), "disclosure-ocr-"));
  for (const language of ["deu", "eng"]) {
    await copyFile(
      join(
        root,
        "node_modules",
        "@tesseract.js-data",
        language,
        "4.0.0",
        `${language}.traineddata.gz`,
      ),
      join(directory, `${language}.traineddata.gz`),
    );
  }
  return directory;
}

export type ExtractOptions = {
  /** Projektwurzel für Sprachdaten, Schriften und WASM-Decoder von pdfjs. */
  root: string;
  onProgress?: (message: string) => void;
};

export async function extractPdfPages(bytes: Uint8Array, options: ExtractOptions) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    verbosity: 0,
    // Ohne die WASM-Decoder rendert pdfjs JBIG2- und JPX-Scans als leere Seite.
    wasmUrl: `${join(options.root, "node_modules", "pdfjs-dist", "wasm")}/`,
    standardFontDataUrl: `${join(options.root, "node_modules", "pdfjs-dist", "standard_fonts")}/`,
  });
  const document = await task.promise;
  const pages: PageInput[] = [];
  let worker: import("tesseract.js").Worker | null = null;
  let languageDirectory: string | null = null;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = (content.items as PdfTextItem[])
        .map(positionedFromPdf)
        .filter((item): item is PositionedItem => item !== null);
      const characters = items.reduce((sum, item) => sum + item.text.trim().length, 0);
      // Eine dünne Textebene kann auch kaputt sein (Bruchstücke über einem Scan);
      // dann entscheidet die Texterkennung, welche Fassung mehr Text liefert.
      const rows = new Set(
        items.filter((item) => item.text.trim()).map((item) => Math.round(item.y / 3)),
      );
      if (characters >= suspiciousTextCharacters && !(rows.size < 12 && characters < 1_500)) {
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          items,
          ocr: false,
        });
        page.cleanup();
        continue;
      }

      options.onProgress?.(`Seite ${pageNumber}: Texterkennung`);
      if (!worker) {
        const tesseract = await import("tesseract.js");
        languageDirectory = await prepareLanguageDirectory(options.root);
        worker = await tesseract.createWorker("deu+eng", tesseract.OEM.LSTM_ONLY, {
          langPath: languageDirectory,
          cacheMethod: "none",
          gzip: true,
        });
        await worker.setParameters({
          tessedit_pageseg_mode: tesseract.PSM.AUTO,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
      }
      const { createCanvas } = await import("@napi-rs/canvas");
      const scaled = page.getViewport({ scale: ocrScale });
      const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport: scaled,
      }).promise;
      const recognized = await worker.recognize(canvas.toBuffer("image/png"), {}, { blocks: true });
      const words: PositionedItem[] = [];
      for (const block of recognized.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const baseline = Math.max(line.baseline.y0, line.baseline.y1);
            const size = Math.max(line.rowAttributes?.rowHeight ?? 0, line.bbox.y1 - line.bbox.y0);
            for (const word of line.words) {
              if (!word.text.trim()) continue;
              words.push({
                text: word.text,
                x: word.bbox.x0 / ocrScale,
                y: viewport.height - baseline / ocrScale,
                width: (word.bbox.x1 - word.bbox.x0) / ocrScale,
                height: (size / ocrScale) * 0.8,
              });
            }
          }
        }
      }
      const recognizedCharacters = words.reduce((sum, word) => sum + word.text.length, 0);
      // Gleich viel Text auf deutlich mehr Zeilen heißt: die Textebene hatte die
      // Reihenfolge verloren (gbs S. 41), die Texterkennung liest sie richtig.
      const recognizedRows = new Set(words.map((word) => Math.round(word.y / 3))).size;
      const useOcr =
        characters < 40 ||
        recognizedCharacters > characters * 1.3 ||
        (recognizedRows >= rows.size * 2 && recognizedCharacters >= characters * 0.7);
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        items: useOcr ? words : items,
        ocr: useOcr,
      });
      page.cleanup();
    }
  } finally {
    await worker?.terminate().catch(() => undefined);
    if (languageDirectory) await rm(languageDirectory, { recursive: true, force: true });
    await task.destroy().catch(() => undefined);
  }
  return pages;
}
