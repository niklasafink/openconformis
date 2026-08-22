import { z } from "zod";

export const maximumPolicyBytes = 25 * 1024 * 1024;
export const pdfMimeType = "application/pdf";
export const docxMimeType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const supportedFiles = {
  ".pdf": pdfMimeType,
  ".docx": docxMimeType,
} as const;

export const policyUploadRequestSchema = z
  .object({
    draftId: z.uuid(),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum([pdfMimeType, docxMimeType]),
    byteSize: z.int().min(1).max(maximumPolicyBytes),
  })
  .superRefine((value, context) => {
    const extension = getPolicyExtension(value.filename);

    if (!extension || supportedFiles[extension] !== value.mimeType) {
      context.addIssue({
        code: "custom",
        path: ["filename"],
        message: "The filename extension and MIME type do not describe the same supported file.",
      });
    }
  });

export type PolicyUploadRequest = z.infer<typeof policyUploadRequestSchema>;

export function getPolicyExtension(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return ".docx" as const;
  if (lower.endsWith(".pdf")) return ".pdf" as const;
  return null;
}

export function sanitizePolicyFilename(filename: string) {
  const normalized = filename.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/gu, "-");
  const compact = normalized.replace(/\s+/gu, " ").trim();
  return compact.slice(0, 255);
}

export function hasSupportedFileSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === pdfMimeType) {
    return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
  }

  if (mimeType === docxMimeType) {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) &&
      [0x04, 0x06, 0x08].includes(bytes[3] ?? -1)
    );
  }

  return false;
}

export function hasDocxPackageEntries(bytes: Uint8Array) {
  const required = new Set(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + 46 <= bytes.byteLength) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const filenameStart = offset + 46;
    const filenameEnd = filenameStart + filenameLength;

    if (filenameEnd > bytes.byteLength) return false;

    const filename = new TextDecoder("utf-8").decode(bytes.slice(filenameStart, filenameEnd));
    required.delete(filename);
    if (required.size === 0) return true;

    offset = filenameEnd + extraLength + commentLength;
  }

  return false;
}
