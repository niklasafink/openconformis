import "server-only";

import mammoth from "mammoth";

import {
  docxMimeType,
  hasDocxPackageEntries,
  hasSupportedFileSignature,
  pdfMimeType,
} from "@/domain/policies/upload";

export type ParsedDocumentBlock = {
  text: string;
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

  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  const paragraphs = result.value
    .split(/\n{2,}/u)
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) throw new Error("DOCX_EMPTY");

  const pageCount = Math.max(1, Math.ceil(result.value.length / 3_000));
  return {
    detectedMimeType: docxMimeType,
    pageCount,
    needsOcr: false,
    blocks: paragraphs.map((text, index) => ({
      text,
      paragraphNumber: index + 1,
    })),
  };
}

async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  if (!hasSupportedFileSignature(bytes, pdfMimeType)) throw new Error("PDF_SIGNATURE_INVALID");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await task.promise;
  const pageCount = document.numPages;
  const blocks: ParsedDocumentBlock[] = [];
  let extractedCharacters = 0;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim();

      extractedCharacters += text.length;
      if (text) blocks.push({ text, pageNumber });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }

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
