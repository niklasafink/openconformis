import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { renderDocxToHtml, sanitizeDocxHtml } from "./docx-html";

describe("sanitizeDocxHtml", () => {
  it("keeps the document structure that makes the original recognisable", () => {
    expect(
      sanitizeDocxHtml("<h1>Richtlinie</h1><p>Absatz mit <strong>Betonung</strong>.</p>"),
    ).toBe("<h1>Richtlinie</h1><p>Absatz mit <strong>Betonung</strong>.</p>");
    expect(sanitizeDocxHtml("<table><tr><td>Zelle</td></tr></table>")).toBe(
      "<table><tr><td>Zelle</td></tr></table>",
    );
  });

  it("drops attributes that could carry behaviour into the page", () => {
    expect(sanitizeDocxHtml('<p onclick="steal()" class="x">Text</p>')).toBe("<p>Text</p>");
    expect(sanitizeDocxHtml('<a href="https://example.invalid">Link</a>')).toBe("Link");
  });

  it("removes scripts and keeps no executable remnant", () => {
    expect(sanitizeDocxHtml("<p>Vor</p><script>alert(1)</script><p>Nach</p>")).toBe(
      "<p>Vor</p>alert(1)<p>Nach</p>",
    );
    expect(sanitizeDocxHtml('<iframe src="https://example.invalid"></iframe>')).toBe("");
  });

  it("allows only embedded images so the preview contacts no foreign server", () => {
    expect(sanitizeDocxHtml('<img src="https://example.invalid/tracker.png" alt="x" />')).toBe("");
    expect(sanitizeDocxHtml('<img src="data:image/png;base64,AAAA" alt="Logo" />')).toBe(
      '<img src="data:image/png;base64,AAAA" alt="Logo" />',
    );
  });

  it("escapes an alternative text that tries to break out of its attribute", () => {
    expect(
      sanitizeDocxHtml('<img src="data:image/png;base64,AAAA" alt="&quot;&gt;<b>" />'),
    ).not.toContain("<b>");
  });
});

describe("renderDocxToHtml", () => {
  it("renders the shipped DOCX as a readable document, not as raw text", async () => {
    const bytes = await readFile(
      resolve(process.cwd(), "assets/samples/beispiel-ikt-sicherheitsrichtlinie.docx"),
    );
    const html = await renderDocxToHtml(bytes);

    expect(html).toContain("IKT-Sicherheitsrichtlinie der Musterbank AG");
    expect(html.match(/<p>/gu)?.length ?? 0).toBeGreaterThan(10);
    expect(html.match(/<h[1-6]>/gu)?.length ?? 0).toBeGreaterThan(0);
    // Kein Element behält Attribute — außer dem eingebetteten Bild.
    expect(html.replace(/<img [^>]*>/gu, "")).not.toMatch(/<[a-z]+\s+[a-z-]+=/iu);
  });
});
