import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docxMimeType } from "@/domain/policies/upload";

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
