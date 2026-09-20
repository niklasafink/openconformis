// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { BudgetBlock } from "@/server/ai/system-one-budget";

import { splitIntoSections } from "./document-sections";

function block(key: string, tokenCount: number): BudgetBlock {
  return { blockKey: key, tokenCount, canonicalText: "x".repeat(tokenCount * 4) };
}

describe("document sections", () => {
  it("groups blocks in document order up to the target", () => {
    const sections = splitIntoSections(
      [block("b1", 800), block("b2", 900), block("b3", 600), block("b4", 100)],
      2_000,
    );

    expect(sections).toEqual([
      { index: 0, blockKeys: ["b1", "b2"], tokenCount: 1_700 },
      { index: 1, blockKeys: ["b3", "b4"], tokenCount: 700 },
    ]);
  });

  it("never splits a block, even one larger than the target", () => {
    // Ein halber Block wäre ein Zitat, das im Dokument so nicht steht.
    const sections = splitIntoSections([block("huge", 9_000), block("small", 10)], 2_000);

    expect(sections[0]).toEqual({ index: 0, blockKeys: ["huge"], tokenCount: 9_000 });
    expect(sections[1]).toEqual({ index: 1, blockKeys: ["small"], tokenCount: 10 });
  });

  it("covers a 40k contract with about twenty sections", () => {
    const blocks = Array.from({ length: 200 }, (_, index) => block(`b${index}`, 200));

    expect(splitIntoSections(blocks, 2_000)).toHaveLength(20);
  });

  it("returns nothing for a document without blocks", () => {
    expect(splitIntoSections([], 2_000)).toEqual([]);
  });
});
