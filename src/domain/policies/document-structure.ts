/**
 * Gliederung hochgeladener Policies.
 *
 * Die KI bekommt Belegkandidaten als einzelne Blöcke. Ein Block pro PDF-Seite
 * oder ein Word-Dokument ohne erkannte Überschriften nimmt ihr genau die
 * Struktur, die ein Markdown-Export trüge: welcher Abschnitt, welche Ebene,
 * Liste oder Tabelle. Statt einer zweiten Markdown-Fassung bekommt deshalb
 * jeder Block Art und Überschriftenpfad. Der Blocktext selbst bleibt reiner
 * Dokumentwortlaut ohne Markdown-Zeichen, weil Zitate exakte Substrings dieser
 * Blöcke sein und im Original wiedergefunden werden müssen.
 */

export type StructuredBlockKind = "heading" | "paragraph" | "list_item" | "table_cell";

export type StructuredBlock = {
  kind: StructuredBlockKind;
  text: string;
  /** Gliederungsebene einer Überschrift; 0 ist der Dokumenttitel. */
  level?: number;
  pageNumber?: number;
};

export type OutlinedBlock = StructuredBlock & { headingPath: string[] };

export function collapseWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

const numberedHeadingPattern = /^(\d{1,2}(?:\.\d{1,2}){0,4})\.?\s+\p{Lu}/u;

/**
 * Ebene einer nummerierten Überschrift wie „2.1 Aufgabentrennung". Lange Zeilen
 * und Zeilen mit Satzzeichen am Ende sind nummerierte Sätze, keine Überschriften.
 */
export function numberedHeadingLevel(text: string) {
  if (text.length > 120 || /[.:;,]$/u.test(text)) return null;
  const numbering = numberedHeadingPattern.exec(text)?.[1];
  return numbering ? numbering.split(".").length : null;
}

/** Hängt an jeden Block die Überschriften, unter denen er steht. */
export function outlineBlocks(blocks: readonly StructuredBlock[]): OutlinedBlock[] {
  const open: Array<{ level: number; text: string }> = [];
  return blocks.map((block) => {
    if (block.kind !== "heading") {
      return { ...block, headingPath: open.map((heading) => heading.text) };
    }
    const level = block.level ?? 1;
    while (open.length > 0 && (open.at(-1)?.level ?? 0) >= level) open.pop();
    const headingPath = open.map((heading) => heading.text);
    open.push({ level, text: block.text });
    return { ...block, headingPath };
  });
}

/* --------------------------------- Word --------------------------------- */

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return namedEntities[entity.toLowerCase()] ?? match;
  });
}

const blockBoundaryTags = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ul",
  "ol",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "blockquote",
  "div",
]);

/**
 * Zerlegt das HTML der Word-Umwandlung in Blöcke. Inline-Auszeichnung fällt
 * weg; Überschriften, Listenpunkte und Tabellenzellen behalten ihre Art. Der
 * Text entspricht damit dem, was die Originalansicht aus demselben HTML zeigt.
 */
export function blocksFromDocumentHtml(html: string): StructuredBlock[] {
  const blocks: StructuredBlock[] = [];
  const open: Array<{ tag: string; title: boolean }> = [];
  let buffer = "";

  const flush = () => {
    const text = collapseWhitespace(decodeEntities(buffer));
    buffer = "";
    if (!text) return;

    const container = open.findLast(({ tag }) => /^(h[1-6]|li|td|th)$/u.test(tag));
    if (container?.tag.startsWith("h")) {
      blocks.push({
        kind: "heading",
        text,
        level: container.title ? 0 : (numberedHeadingLevel(text) ?? Number(container.tag[1])),
      });
    } else if (container?.tag === "li") {
      blocks.push({ kind: "list_item", text });
    } else if (container) {
      blocks.push({ kind: "table_cell", text });
    } else {
      // Nummerierte Abschnittstitel, die in Word nur fett statt als
      // Überschrift formatiert sind.
      const level = numberedHeadingLevel(text);
      blocks.push(level === null ? { kind: "paragraph", text } : { kind: "heading", text, level });
    }
  };

  let consumed = 0;
  for (const match of html.matchAll(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/gu,
  )) {
    buffer += html.slice(consumed, match.index);
    consumed = match.index + match[0].length;
    const tag = match[1]?.toLowerCase() ?? "";
    if (tag === "br") {
      buffer += " ";
      continue;
    }
    if (!blockBoundaryTags.has(tag)) continue;

    flush();
    if (match[0].startsWith("</")) {
      const index = open.map((entry) => entry.tag).lastIndexOf(tag);
      if (index >= 0) open.length = index;
    } else {
      open.push({ tag, title: /class\s*=\s*"[^"]*\btitle\b/u.test(match[2] ?? "") });
    }
  }
  buffer += html.slice(consumed);
  flush();

  return blocks;
}

/* ---------------------------------- PDF --------------------------------- */

export type PositionedText = {
  text: string;
  /** Linker Rand und Breite des Textstücks in PDF-Koordinaten. */
  x: number;
  width: number;
  /** Grundlinie in PDF-Koordinaten; größere Werte liegen weiter oben. */
  y: number;
  height: number;
  endOfLine: boolean;
};

export type PdfLine = { text: string; y: number; height: number };

/**
 * Setzt die Textstücke einer Seite zu Zeilen zusammen. Stücke, die lückenlos
 * aneinanderstoßen, gehören zu einem Wort — pdf.js liefert Ligaturen wie „fi"
 * als eigenes Stück. Nur eine echte Lücke wird zum Leerzeichen. Die PDF-Ansicht
 * sucht Zitate ohne Leerraum, findet sie also in beiden Fällen.
 */
export function pdfLinesFromText(items: readonly PositionedText[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let text = "";
  let y = 0;
  let height = 0;
  let lineEnd = 0;

  const close = () => {
    const line = collapseWhitespace(text);
    if (line) lines.push({ text: line, y, height });
    text = "";
    height = 0;
  };

  for (const item of items) {
    const hasText = item.text.trim().length > 0;
    if (hasText && text) {
      const tolerance = Math.max(height, item.height, 1) * 0.5;
      if (Math.abs(item.y - y) > tolerance) close();
    }
    if (hasText) {
      if (!text) {
        y = item.y;
        text = item.text;
      } else {
        const touching = Math.abs(item.x - lineEnd) <= Math.max(height, item.height, 1) * 0.15;
        text += touching ? item.text : ` ${item.text}`;
      }
      lineEnd = item.x + item.width;
      height = Math.max(height, item.height);
    }
    if (item.endOfLine) close();
  }
  close();

  return lines;
}

const listMarkerPattern = /^(?:[•▪◦●○■□‣∙·–—*-]|\(?[a-zA-Z0-9]{1,3}[.)])\s+/u;
const pageFurniturePattern = /^(?:(?:seite|page)\s*)?\d{1,4}(?:\s*(?:von|of|\/)\s*\d{1,4})?$/iu;

/**
 * Bildet aus den Zeilen aller Seiten Überschriften, Absätze und Listenpunkte.
 * Absätze trennt ein größerer Zeilenabstand, Überschriften erkennt die
 * Nummerierung oder eine deutlich größere Schrift als der Fließtext. Blöcke
 * überschreiten keine Seitengrenze, damit die Seitenangabe eindeutig bleibt.
 */
export function blocksFromPdfPages(pages: readonly (readonly PdfLine[])[]): StructuredBlock[] {
  const heights = pages
    .flat()
    .map((line) => line.height)
    .filter((height) => height > 0)
    .sort((left, right) => left - right);
  const bodyHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  const blocks: StructuredBlock[] = [];

  pages.forEach((lines, pageIndex) => {
    const pageNumber = pageIndex + 1;
    let current: {
      kind: StructuredBlockKind;
      level?: number;
      parts: string[];
      last: PdfLine;
      largeFont: boolean;
    } | null = null;

    const flush = () => {
      if (!current) return;
      blocks.push({
        kind: current.kind,
        text: collapseWhitespace(current.parts.join(" ")),
        ...(current.level === undefined ? {} : { level: current.level }),
        pageNumber,
      });
      current = null;
    };

    for (const line of lines) {
      if (pageFurniturePattern.test(line.text)) continue;

      const largeFont = bodyHeight > 0 && line.height >= bodyHeight * 1.2;
      const numberedLevel = numberedHeadingLevel(line.text);
      const headingLike =
        numberedLevel !== null ||
        (largeFont && line.text.length <= 150 && !/[.:;,]$/u.test(line.text));
      const previous = current as typeof current;
      const gap = previous ? previous.last.y - line.y : 0;
      const closeBelow =
        previous !== null && gap > 0 && gap <= Math.max(previous.last.height, line.height, 1) * 1.5;

      if (headingLike) {
        // Eine große Überschrift, die über zwei Zeilen umbricht, bleibt eine.
        if (
          previous?.kind === "heading" &&
          previous.largeFont &&
          largeFont &&
          numberedLevel === null &&
          closeBelow
        ) {
          previous.parts.push(line.text);
          previous.last = line;
          continue;
        }
        flush();
        current = {
          kind: "heading",
          level: numberedLevel ?? 1,
          parts: [line.text],
          last: line,
          largeFont,
        };
        continue;
      }

      if (listMarkerPattern.test(line.text)) {
        flush();
        current = { kind: "list_item", parts: [line.text], last: line, largeFont };
        continue;
      }

      if (previous && previous.kind !== "heading" && closeBelow) {
        previous.parts.push(line.text);
        previous.last = line;
        continue;
      }

      flush();
      current = { kind: "paragraph", parts: [line.text], last: line, largeFont };
    }
    flush();
  });

  return blocks;
}
