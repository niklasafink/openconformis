// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  findQuoteSpans,
  highlightQuoteInElement,
  splitEvidenceHighlight,
} from "./policy-document-viewer";

function render(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("highlightQuoteInElement", () => {
  it("marks the quote inside the rendered original document", () => {
    const container = render("<p>Vorher Das Leitungsorgan genehmigt den Rahmen. Nachher</p>");
    const marked = highlightQuoteInElement(container, "Das Leitungsorgan genehmigt den Rahmen.");

    expect(marked?.textContent).toBe("Das Leitungsorgan genehmigt den Rahmen.");
    expect(container.querySelectorAll("mark[data-evidence]")).toHaveLength(1);
  });

  it("finds the quote although the rendered document spaces and cases it differently", () => {
    const container = render("<p>  Das\n  Leitungsorgan   GENEHMIGT den Rahmen.</p>");
    const marked = highlightQuoteInElement(container, "Leitungsorgan genehmigt den Rahmen.");

    expect(marked?.textContent).toBe("Leitungsorgan   GENEHMIGT den Rahmen.");
  });

  it("aligns the offset when the rendered text starts with whitespace", () => {
    const container = render("<p> Der Rahmen wird jährlich überprüft.</p>");
    const marked = highlightQuoteInElement(container, "Der Rahmen");

    expect(marked?.textContent).toBe("Der Rahmen");
  });

  it("matches typographic quotation marks and dashes against the plain text quote", () => {
    const container = render("<p>Die „Richtlinie“ gilt bank–weit.</p>");
    const marked = highlightQuoteInElement(container, '"Richtlinie" gilt bank-weit.');

    expect(marked?.textContent).toBe("„Richtlinie“ gilt bank–weit.");
  });

  it("removes the previous highlight so two marks never overlap", () => {
    const container = render("<p>Erster Satz. Zweiter Satz.</p>");
    highlightQuoteInElement(container, "Erster Satz.");
    highlightQuoteInElement(container, "Zweiter Satz.");

    const marks = container.querySelectorAll("mark[data-evidence]");
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("Zweiter Satz.");
    expect(container.textContent).toBe("Erster Satz. Zweiter Satz.");
  });

  it("leaves the document untouched when the quote is absent or empty", () => {
    const container = render("<p>Nur dieser Satz.</p>");
    expect(highlightQuoteInElement(container, "Ein anderer Satz.")).toBeNull();
    expect(highlightQuoteInElement(container, "   ")).toBeNull();
    expect(container.innerHTML).toBe("<p>Nur dieser Satz.</p>");
  });
});

describe("splitEvidenceHighlight", () => {
  it("returns nothing for an empty quote", () => {
    expect(splitEvidenceHighlight("Policy", "")).toBeNull();
  });
});

describe("findQuoteSpans", () => {
  // So zerlegt pdf.js eine Zeile wirklich: die Stücke enden nicht an
  // Wortgrenzen, und der ausgelesene Text enthält deshalb „gene hmigt".
  const spans = ["Das Leitungsorgan legt den Rahmen fest, gene", "hmigt", " ihn jaehrlich."];

  it("finds a quote whose words the renderer splits differently", () => {
    expect(findQuoteSpans(spans, "fest, gene hmigt ihn")).toEqual([0, 1, 2]);
  });

  it("marks only the sections the quote actually touches", () => {
    expect(findQuoteSpans(spans, "Das Leitungsorgan")).toEqual([0]);
    expect(findQuoteSpans(spans, "ihn jaehrlich.")).toEqual([2]);
  });

  it("ignores case and typographic characters", () => {
    expect(
      findQuoteSpans(["Die „Richtlinie“ gilt bank–weit."], '"richtlinie" gilt bank-weit'),
    ).toEqual([0]);
  });

  it("returns nothing for an absent or empty quote", () => {
    expect(findQuoteSpans(spans, "steht nicht im Dokument")).toEqual([]);
    expect(findQuoteSpans(spans, "   ")).toEqual([]);
  });
});
