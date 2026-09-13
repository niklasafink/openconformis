import "server-only";

import { createRequire } from "node:module";
import { join } from "node:path";

import mammoth from "mammoth";

import {
  blocksFromDocumentHtml,
  blocksFromPdfPages,
  outlineBlocks,
  pdfLinesFromText,
  type PdfLine,
  type StructuredBlockKind,
} from "@/domain/policies/document-structure";
import {
  docxMimeType,
  hasDocxPackageEntries,
  hasSupportedFileSignature,
  pdfMimeType,
} from "@/domain/policies/upload";

export type ParsedDocumentBlock = {
  kind: StructuredBlockKind;
  text: string;
  headingPath: string[];
  pageNumber?: number;
  paragraphNumber?: number;
};

export type ParsedDocument = {
  detectedMimeType: typeof pdfMimeType | typeof docxMimeType;
  pageCount: number;
  blocks: ParsedDocumentBlock[];
  needsOcr: boolean;
};

const maximumDeclaredDocxExpansion = 100 * 1024 * 1024;
const maximumZipEntries = 10_000;

function declaredDocxExpansion(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let entries = 0;
  let expandedBytes = 0;

  while (offset + 46 <= bytes.byteLength) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    entries += 1;
    if (entries > maximumZipEntries) throw new Error("DOCX_TOO_MANY_ENTRIES");
    expandedBytes += view.getUint32(offset + 24, true);
    if (expandedBytes > maximumDeclaredDocxExpansion) throw new Error("DOCX_EXPANSION_TOO_LARGE");

    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return expandedBytes;
}

async function parseDocx(bytes: Uint8Array): Promise<ParsedDocument> {
  if (!hasSupportedFileSignature(bytes, docxMimeType) || !hasDocxPackageEntries(bytes)) {
    throw new Error("DOCX_SIGNATURE_INVALID");
  }
  if (declaredDocxExpansion(bytes) === 0) throw new Error("DOCX_DIRECTORY_INVALID");

  // Dieselbe Umwandlung wie die Originalansicht (`renderDocxToHtml`), damit
  // Blocktext und angezeigter Wortlaut übereinstimmen. Die Klasse markiert nur
  // den Dokumenttitel als oberste Gliederungsebene.
  const result = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes) },
    {
      styleMap: ["p[style-name='Title'] => h1.title:fresh", "p[style-name='Subtitle'] => h2:fresh"],
    },
  );
  const blocks = outlineBlocks(blocksFromDocumentHtml(result.value));
  if (blocks.length === 0) throw new Error("DOCX_EMPTY");

  const characters = blocks.reduce((total, block) => total + block.text.length, 0);
  return {
    detectedMimeType: docxMimeType,
    pageCount: Math.max(1, Math.ceil(characters / 3_000)),
    needsOcr: false,
    blocks: blocks.map(({ kind, text, headingPath }, index) => ({
      kind,
      text,
      headingPath,
      paragraphNumber: index + 1,
    })),
  };
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  if (!hasSupportedFileSignature(bytes, pdfMimeType)) throw new Error("PDF_SIGNATURE_INVALID");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js kommt mit dem relativen Vorgabewert `./pdf.worker.mjs`, den es neben
  // seiner eigenen Datei sucht. Gebündelt zeigt der in ein Chunk-Verzeichnis
  // ohne Workerdatei, und jedes PDF scheiterte mit „Setting up fake worker
  // failed". Weil der Vorgabewert belegt ist, muss er überschrieben werden.
  // Aufgelöst wird vom Projektstamm aus: `import.meta.url` ist im Bundle ein
  // virtueller Pfad, von dem aus sich `node_modules` nicht finden lässt.
  pdfjs.GlobalWorkerOptions.workerSrc = createRequire(join(process.cwd(), "package.json")).resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await task.promise;
  const pageCount = document.numPages;
  const pages: PdfLine[][] = [];
  let extractedCharacters = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = pdfLinesFromText(
        content.items.flatMap((item) =>
          "str" in item
            ? [
                {
                  text: item.str,
                  x: item.transform[4] ?? 0,
                  width: item.width,
                  y: item.transform[5] ?? 0,
                  height: item.height || Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0),
                  endOfLine: item.hasEOL,
                },
              ]
            : [],
        ),
      );

      extractedCharacters += lines.reduce((total, line) => total + line.text.length, 0);
      pages.push(lines);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

  const paragraphsOnPage = new Map<number, number>();
  const blocks = outlineBlocks(blocksFromPdfPages(pages)).map(
    ({ kind, text, headingPath, pageNumber }) => {
      const paragraphNumber = (paragraphsOnPage.get(pageNumber ?? 0) ?? 0) + 1;
      paragraphsOnPage.set(pageNumber ?? 0, paragraphNumber);
      return { kind, text, headingPath, pageNumber, paragraphNumber };
    },
  );

  return {
    detectedMimeType: pdfMimeType,
    pageCount,
    blocks,
    needsOcr: extractedCharacters < Math.max(80, pageCount * 20),
  };
}

export async function parsePolicyDocument(bytes: Uint8Array, declaredMimeType: string) {
  if (declaredMimeType === pdfMimeType) return parsePdf(bytes);
  if (declaredMimeType === docxMimeType) return parseDocx(bytes);
  throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
}
