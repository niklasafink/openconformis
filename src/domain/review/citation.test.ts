// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  cellCitationOutcome,
  citationCheckFromAnswer,
  citationExcerpt,
  groundCitation,
  normalizeQuote,
  worstCitationVerdict,
  type CitationBlock,
} from "./citation";

const block: CitationBlock = {
  documentBlockId: "block-1",
  blockKey: "b1",
  canonicalText: "Der Vertrag kann von beiden Parteien aus wichtigem  Grund gekündigt werden.",
  textHash: "hash",
  pageNumber: 3,
  paragraphNumber: 12,
};

describe("citation grounding", () => {
  it("accepts an exact quote and tolerates only whitespace differences", () => {
    expect(groundCitation("aus wichtigem Grund gekündigt werden", block)?.quote).toBe(
      "aus wichtigem Grund gekündigt werden",
    );
    expect(groundCitation("  aus wichtigem\nGrund  ", block)?.quote).toBe("aus wichtigem Grund");
  });

  it("rejects an invented quote without asking a model", () => {
    // Die härteste und die billigste Stufe zugleich: kein Aufruf, keine Kosten.
    expect(groundCitation("Die Kündigung ist ausgeschlossen.", block)).toBeUndefined();
  });

  it("rejects an empty quote and an unknown block", () => {
    expect(groundCitation("   ", block)).toBeUndefined();
    expect(groundCitation("aus wichtigem Grund", undefined)).toBeUndefined();
  });
});

describe("citation verdict", () => {
  it("accepts a supporting quote above the threshold without a second opinion", () => {
    expect(
      citationCheckFromAnswer({
        type: "choice",
        choice: "supports",
        confidence: 0.86,
        probabilities: { supports: 0.86, contradicts: 0.04, silent: 0.1 },
      }),
    ).toEqual({ verdict: "verified", confidenceBp: 8600, needsReview: false });
  });

  it("sends a supporting quote below 0.8 to review instead of a quiet result", () => {
    expect(
      citationCheckFromAnswer({
        type: "choice",
        choice: "supports",
        confidence: 0.61,
        probabilities: { supports: 0.61, contradicts: 0.19, silent: 0.2 },
      }),
    ).toEqual({ verdict: "verified", confidenceBp: 6100, needsReview: true });
  });

  it("always sends a contradicting quote to review, however confident", () => {
    expect(
      citationCheckFromAnswer({
        type: "choice",
        choice: "contradicts",
        confidence: 0.99,
        probabilities: { supports: 0.005, contradicts: 0.99, silent: 0.005 },
      }),
    ).toEqual({ verdict: "contradicted", confidenceBp: 9900, needsReview: true });
  });

  it("treats a quote that says nothing as unsupported", () => {
    expect(
      citationCheckFromAnswer({
        type: "choice",
        choice: "silent",
        confidence: 0.9,
        probabilities: { supports: 0.05, contradicts: 0.05, silent: 0.9 },
      }),
    ).toMatchObject({ verdict: "unsupported", needsReview: true });
  });

  it("treats a wrongly typed answer as unsupported rather than as a pass", () => {
    expect(citationCheckFromAnswer({ type: "noul", noul: 0.95 })).toEqual({
      verdict: "unsupported",
      confidenceBp: 0,
      needsReview: true,
    });
  });

  it("lets the strictest verdict of the list decide the cell", () => {
    expect(worstCitationVerdict(["verified", "contradicted", "verified"])).toBe("contradicted");
    expect(worstCitationVerdict(["verified", "unsupported"])).toBe("unsupported");
    expect(worstCitationVerdict(["unsupported", "fabricated"])).toBe("fabricated");
    expect(worstCitationVerdict(["verified"])).toBe("verified");
    expect(worstCitationVerdict([])).toBeUndefined();
  });
});

describe("cell citation outcome", () => {
  const verified = (confidenceBp: number) => ({
    verdict: "verified" as const,
    confidenceBp,
    needsReview: false,
  });
  const other = (verdict: "contradicted" | "unsupported" | "fabricated") => ({
    verdict,
    confidenceBp: 9_000,
    needsReview: true,
  });

  it("accepts one supporting passage even when another one is merely silent", () => {
    expect(cellCitationOutcome([verified(9_000), other("unsupported")])).toEqual({
      verdict: "verified",
      needsReview: false,
    });
  });

  it("lets a fabricated quote decide, whatever else supports the answer", () => {
    expect(cellCitationOutcome([verified(9_900), other("fabricated")])).toEqual({
      verdict: "fabricated",
      needsReview: true,
    });
  });

  it("puts a contradiction on review even next to a strong supporting passage", () => {
    expect(cellCitationOutcome([verified(9_900), other("contradicted")]).needsReview).toBe(true);
  });

  it("needs review when the best supporting passage is below the threshold or absent", () => {
    expect(cellCitationOutcome([verified(7_000)]).needsReview).toBe(true);
    expect(cellCitationOutcome([])).toEqual({ verdict: "unsupported", needsReview: true });
  });
});

describe("citation excerpt", () => {
  it("returns short blocks whole and long blocks as an exact prefix at a sentence end", () => {
    const short = "Kurzer  Satz\nüber zwei Zeilen.";
    expect(citationExcerpt(short)).toBe("Kurzer Satz über zwei Zeilen.");

    const long = `${"Erster Satz mit einigem Inhalt. ".repeat(40)}Schluss`;
    const excerpt = citationExcerpt(long, 200);
    expect(excerpt.length).toBeLessThanOrEqual(200);
    expect(excerpt.endsWith(".")).toBe(true);
    // Immer ein exakter Substring des normalisierten Blocks, nie eine Umschreibung.
    expect(normalizeQuote(long)).toContain(excerpt);
  });

  it("cuts at a word boundary when the text has no sentence end", () => {
    const text = "wort ".repeat(100);
    const excerpt = citationExcerpt(text, 50);
    expect(excerpt.length).toBeLessThanOrEqual(50);
    expect(text).toContain(excerpt);
  });
});
