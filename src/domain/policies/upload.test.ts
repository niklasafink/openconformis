import { describe, expect, it } from "vitest";

import {
  docxMimeType,
  hasDocxPackageEntries,
  hasSupportedFileSignature,
  maximumPolicyBytes,
  pdfMimeType,
  policyUploadRequestSchema,
  sanitizePolicyFilename,
} from "./upload";

describe("policy upload boundary", () => {
  it("accepts matching PDF metadata", () => {
    expect(
      policyUploadRequestSchema.safeParse({
        draftId: "4bc207d3-425d-40b7-aa9e-8de0768042e4",
        filename: "policy.pdf",
        mimeType: pdfMimeType,
        byteSize: maximumPolicyBytes,
      }).success,
    ).toBe(true);
  });

  it("rejects mismatched extensions and MIME types", () => {
    expect(
      policyUploadRequestSchema.safeParse({
        draftId: "4bc207d3-425d-40b7-aa9e-8de0768042e4",
        filename: "policy.pdf",
        mimeType: docxMimeType,
        byteSize: 20,
      }).success,
    ).toBe(false);
  });

  it("recognizes supported file signatures", () => {
    expect(hasSupportedFileSignature(new TextEncoder().encode("%PDF-1.7"), pdfMimeType)).toBe(true);
    expect(hasSupportedFileSignature(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), docxMimeType)).toBe(
      true,
    );
  });

  it("requires core OOXML package entries", () => {
    const entry = (name: string) => {
      const encoded = new TextEncoder().encode(name);
      const bytes = new Uint8Array(46 + encoded.length);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(28, encoded.length, true);
      bytes.set(encoded, 46);
      return bytes;
    };
    const entries = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"].map(entry);
    const combined = new Uint8Array(entries.reduce((sum, item) => sum + item.length, 0));
    let offset = 0;
    for (const bytes of entries) {
      combined.set(bytes, offset);
      offset += bytes.length;
    }

    expect(hasDocxPackageEntries(combined)).toBe(true);
  });

  it("removes path separators and controls from filenames", () => {
    expect(sanitizePolicyFilename("../in\u0000ternal\\policy.pdf")).toBe("..-in-ternal-policy.pdf");
  });
});
