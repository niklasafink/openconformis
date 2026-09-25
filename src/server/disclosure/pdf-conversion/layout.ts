/**
 * Seitenlayout → Dokumentmodell für das lokale Werkzeug `pnpm disclosure:pdf-to-docx`.
 *
 * Reine Funktionen ohne KI: Textstücke mit Position (aus pdfjs oder aus der
 * Texterkennung) werden zu Zeilen, Zeilen zu Absätzen, Überschriften, Listenpunkten
 * und echten Tabellen. Die Heuristik ist bewusst einfach und an den Beispielberichten
 * geprüft; sie läuft nie im Upload-Pfad, sondern nur auf dem Rechner des Nutzers.
 */

export type PositionedItem = Readonly<{
  text: string;
  /** Linke Kante in PDF-Punkten. */
  x: number;
  /** Grundlinie in PDF-Punkten, von unten gemessen. */
  y: number;
  width: number;
  /** Schriftgröße bzw. Höhe des Wortes. */
  height: number;
}>;

export type PageInput = Readonly<{
  pageNumber: number;
  width: number;
  height: number;
  items: readonly PositionedItem[];
  /** Die Seite hatte keine (brauchbare) Textebene und wurde per Texterkennung gelesen. */
  ocr: boolean;
}>;

export type TableRow = { cells: string[]; header: boolean };

export type DocumentNode =
  | { kind: "pageMarker"; page: number }
  | { kind: "ocrNote" }
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "listItem"; text: string }
  | { kind: "table"; rows: TableRow[] };

export type Segment = { text: string; x: number; right: number };

export type Line = {
  y: number;
  fontSize: number;
  segments: Segment[];
  text: string;
};

/** Aufzählungszeichen, auch die Symbolschrift-Zeichen aus dem Unicode-Privatbereich. */
const bulletCharacters = "•▪■●\u{f02d}\u{f06c}\u{f076}\u{f0a7}\u{f0b7}\u{f0d8}\u{f0fc}";
const bulletPattern = new RegExp(`^[${bulletCharacters}–-]$`, "u");
const leadingBulletPattern = new RegExp(`^[${bulletCharacters}]\\s*`, "u");
const numericPattern = /^\(?[-–+]?\s?\d(?:[\d.,' ]*\d)?\s?(?:%|‰)?\)?$|^[-–]$/u;
const datePattern = /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}$/u;
const yearPattern = /^(?:19|20)\d{2}$/u;
/** Gliederungszeichen vor einem Label: „4.“, „a)“, „II.“, „aa)“, „B.“. */
const enumerationPattern = /^(?:\d{1,2}[.)]|[a-z]{1,2}\)|[IVX]{1,4}\.|[A-H]\.)$/u;
const enumeratedLabelPattern = /^(?:\d{1,2}[.)]|[a-z]{1,2}\)|[IVX]{1,4}\.|[A-H]\.)\s/u;
const headingPattern = /^(\d{1,2}(?:\.\d{1,2}){0,4})\.?\s+\p{Lu}/u;
const conjunctions = new Set(["und", "oder", "bzw.", "sowie", "bis", "als", "noch"]);

export function isNumericCell(text: string) {
  const value = text.trim();
  if (datePattern.test(value)) return false;
  return numericPattern.test(value);
}

function isHeaderCell(text: string) {
  const value = text.trim();
  return datePattern.test(value) || yearPattern.test(value) || !isNumericCell(value);
}

function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

const center = (segment: Segment) => (segment.x + segment.right) / 2;

/** Wörter derselben Grundlinie zu einer Zeile, getrennt nach großen Lücken. */
export function buildLines(items: readonly PositionedItem[]): Line[] {
  const visible = items.filter((item) => item.text.trim().length > 0);
  const sorted = [...visible].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PositionedItem[][] = [];
  for (const item of sorted) {
    const row = rows.at(-1);
    const tolerance = Math.max(1.5, 0.45 * Math.max(item.height, 4));
    if (row && Math.abs(row[0]!.y - item.y) <= tolerance) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    const ordered = row.sort((a, b) => a.x - b.x);
    const fontSize = median(ordered.map((item) => Math.max(item.height, 4)));
    const segments: Segment[] = [];
    for (const item of ordered) {
      const text = item.text.replace(/\s+/gu, " ");
      const last = segments.at(-1);
      const gap = last ? item.x - last.right : Infinity;
      // Zahlenspalten, Randziffern und Aufzählungszeichen bleiben eigene Stücke,
      // sobald eine sichtbare Lücke sie trennt; Gliederungszeichen („4.“) bleiben am
      // Label. Nur Fließtext wird über gespreizte Wortabstände verbunden.
      const separate =
        last !== undefined &&
        !enumerationPattern.test(last.text.trim()) &&
        gap > 0.6 * fontSize &&
        (isNumericCell(last.text) || isNumericCell(text) || bulletPattern.test(last.text.trim()));
      if (last && gap <= 0.18 * fontSize) {
        last.text = `${last.text}${text}`.replace(/\s+/gu, " ");
        last.right = Math.max(last.right, item.x + item.width);
      } else if (last && !separate && gap <= 1.6 * fontSize) {
        last.text = `${last.text.trimEnd()} ${text.trimStart()}`;
        last.right = Math.max(last.right, item.x + item.width);
      } else {
        segments.push({ text, x: item.x, right: item.x + item.width });
      }
    }
    const cleaned = segments
      .map((segment) => ({ ...segment, text: segment.text.trim() }))
      .filter((segment) => segment.text.length > 0);
    return {
      y: median(ordered.map((item) => item.y)),
      fontSize,
      segments: joinProseSegments(cleaned, fontSize),
      text: cleaned.map((segment) => segment.text).join(" "),
    };
  });
}

/**
 * Starker Blocksatz spreizt Wortabstände über die Zusammenfassungsgrenze hinaus.
 * Viele Wörter ohne Zahl mit mäßigen Lücken sind Fließtext; weite Lücken dagegen
 * sind Spaltenköpfe („Inland | Europa | China“) und bleiben getrennt.
 */
function joinProseSegments(segments: Segment[], fontSize: number): Segment[] {
  if (segments.length < 3) return segments;
  if (segments.some((segment) => isNumericCell(segment.text))) return segments;
  const gaps = segments.slice(1).map((segment, index) => segment.x - segments[index]!.right);
  const wordy = segments.filter((segment) => !/\d/u.test(segment.text)).length;
  if (wordy < 3 || Math.max(...gaps) > 3.2 * fontSize) return segments;
  return [
    {
      text: segments.map((segment) => segment.text).join(" "),
      x: segments[0]!.x,
      right: segments.at(-1)!.right,
    },
  ];
}

function marginKey(text: string) {
  return text.replace(/\d+/gu, "#").replace(/\s+/gu, " ").trim().toLowerCase();
}

function inMargin(line: Line, height: number) {
  return line.y > height * 0.9 || line.y < height * 0.08;
}

/**
 * Kopf- und Fußzeilen: Zeilen am oberen oder unteren Rand, die (mit Ziffern als
 * Platzhalter) auf vielen Seiten gleich lauten — etwa „AWADO GmbH“ oder
 * „212253 - gbs … - 2 -“.
 */
export function repeatedMarginTexts(pages: readonly { lines: Line[]; height: number }[]) {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.lines) if (inMargin(line, page.height)) seen.add(marginKey(line.text));
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.25));
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([key]) => key));
}

type Classified =
  | { kind: "row"; line: Line; label: string; values: Segment[]; weak: boolean }
  | { kind: "header"; line: Line }
  | { kind: "label"; line: Line }
  | { kind: "bullet"; line: Line; text: string }
  | { kind: "tz"; line: Line; number: string; text: string }
  | { kind: "text"; line: Line };

const unitRunPattern = /^(?:(?:in\s)?(?:T?EUR|T€|Mio\.?\s?EUR|%)\s*){2,}$/u;
const unitTokenPattern = /(?:in\s)?(?:T?EUR|T€|Mio\.?\s?EUR|%)/gu;

/**
 * Einheitenzeilen („in EUR in TEUR in EUR …“) verschmelzen wegen enger Abstände zu
 * einem Stück. Sie werden wieder in Einzelköpfe zerlegt, die x-Lage anteilig nach
 * Zeichenposition geschätzt — genau genug, um sie der nächsten Spalte zuzuordnen.
 */
function splitUnitRun(segment: Segment): Segment[] | null {
  if (!unitRunPattern.test(segment.text)) return null;
  const width = segment.right - segment.x;
  const length = segment.text.length;
  return [...segment.text.matchAll(unitTokenPattern)].map((match) => ({
    text: match[0].trim(),
    x: segment.x + (width * match.index) / length,
    right: segment.x + (width * (match.index + match[0].trimEnd().length)) / length,
  }));
}

function classify(sourceLine: Line, pageWidth: number, bodyX: number): Classified {
  const units = sourceLine.segments.length === 1 ? splitUnitRun(sourceLine.segments[0]!) : null;
  const line = units ? { ...sourceLine, segments: units } : sourceLine;
  const segments = line.segments;
  const first = segments[0]!;
  if (bulletPattern.test(first.text) && segments.length > 1) {
    const text = segments
      .slice(1)
      .map((segment) => segment.text)
      .join(" ");
    return { kind: "bullet", line, text };
  }
  if (leadingBulletPattern.test(first.text) && first.text.length > 2) {
    return { kind: "bullet", line, text: line.text.replace(leadingBulletPattern, "") };
  }
  let tail = 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!isNumericCell(segments[index]!.text)) break;
    tail += 1;
  }
  const labelCount = segments.length - tail;
  const values = segments.slice(labelCount);
  if (tail > 0 && labelCount === 0 && values.every((value) => yearPattern.test(value.text))) {
    return { kind: "header", line };
  }
  if (tail > 0 && labelCount <= 3) {
    const strong = tail >= 2 || (values[0]!.x > pageWidth * 0.45 && labelCount <= 2);
    const label = segments
      .slice(0, labelCount)
      .map((segment) => segment.text)
      .join(" ");
    return { kind: "row", line, label, values, weak: !strong };
  }
  if (
    segments.length >= 2 &&
    /^\d{1,3}$/u.test(first.text) &&
    first.right < bodyX - 0.3 * line.fontSize &&
    segments[1]!.x - first.right > 0.6 * line.fontSize
  ) {
    const text = segments
      .slice(1)
      .map((segment) => segment.text)
      .join(" ");
    return { kind: "tz", line, number: first.text, text };
  }
  if (
    segments.length >= 2 &&
    segments.every((segment) => segment.text.length <= 32 && isHeaderCell(segment.text))
  ) {
    return { kind: "header", line };
  }
  if (segments.length === 1 && line.text.length <= 70 && !/[.;:]$/u.test(line.text)) {
    return { kind: "label", line };
  }
  return { kind: "text", line };
}

function headingLevel(text: string) {
  if (text.length > 100 || /[.;:,]$/u.test(text)) return null;
  const match = headingPattern.exec(text);
  if (!match) return null;
  return Math.min(4, match[1]!.split(".").filter(Boolean).length);
}

/** Silbentrennung am Zeilenende auflösen, außer vor Bindewörtern („Vermögens- und“). */
export function joinLines(previous: string, next: string) {
  if (/[A-Za-zÄÖÜäöüß]-$/u.test(previous)) {
    const nextWord = next.split(/\s+/u)[0] ?? "";
    if (/^\p{Ll}/u.test(nextWord) && !conjunctions.has(nextWord)) {
      return `${previous.slice(0, -1)}${next}`;
    }
  }
  return `${previous} ${next}`;
}

type DraftRow = { label: string; values: Segment[]; header: Segment[] | null };
type TableDraft = { rows: DraftRow[]; fontSize: number };

/**
 * Spaltenpositionen: Gibt es eine Kopfzeile mit mindestens so vielen Stücken wie die
 * breiteste Zahlenzeile, bestimmt sie die Spalten (Mitte je Kopf). Sonst werden die
 * rechten Kanten der Zahlen gebündelt — Zahlen stehen rechtsbündig.
 */
function tableColumns(draft: TableDraft) {
  const widest = Math.max(...draft.rows.map((row) => row.values.length));
  const header = draft.rows
    .filter((row) => row.header && row.header.length >= Math.max(2, widest))
    .sort((a, b) => b.header!.length - a.header!.length)[0];
  if (header) {
    const positions = header.header!.map(center);
    return {
      count: positions.length,
      locate: (segment: Segment) => nearestIndex(positions, center(segment)),
    };
  }
  const edges = draft.rows
    .flatMap((row) => row.values.map((segment) => segment.right))
    .sort((a, b) => a - b);
  const tolerance = Math.max(6, draft.fontSize * 1.1);
  const positions: number[] = [];
  for (const edge of edges) {
    const last = positions.at(-1);
    if (last !== undefined && edge - last <= tolerance) positions[positions.length - 1] = edge;
    else positions.push(edge);
  }
  return {
    count: positions.length,
    locate: (segment: Segment) => nearestIndex(positions, segment.right),
    headerLocate: (segment: Segment) => nearestIndex(positions, segment.right),
  };
}

function nearestIndex(positions: readonly number[], value: number) {
  let best = 0;
  for (let index = 1; index < positions.length; index += 1) {
    if (Math.abs(positions[index]! - value) < Math.abs(positions[best]! - value)) best = index;
  }
  return best;
}

/**
 * Mehrzeilige Zellen: Eine Zeile, deren Werte in anderen Spalten stehen als die der
 * vorigen, gehört zu ihr, wenn eines der Labels fehlt oder das zweite nur ein
 * einzelnes Wort ohne Gliederungszeichen ist („2. Zinsen und ähnliche“ /
 * „Aufwendungen“). Echte Folgezeilen tragen dagegen eigene Gliederungszeichen.
 */
function mergeContinuationRows(rows: TableRow[]) {
  const merged: TableRow[] = [];
  for (const row of rows) {
    const previous = merged.at(-1);
    if (previous && !previous.header && !row.header) {
      const occupied = (entry: TableRow) =>
        entry.cells.map((cell, index) => (index > 0 && cell ? index : -1)).filter((i) => i > 0);
      const overlap = occupied(row).some((index) => occupied(previous).includes(index));
      const label = row.cells[0]!.trim();
      const previousLabel = previous.cells[0]!.trim();
      const enumerated = enumeratedLabelPattern.test(`${label} `);
      const openEnded = /(?:^|\s)\p{Ll}\S*$/u.test(previousLabel);
      const continuation =
        label === "" ||
        (!enumerated && /^\p{Ll}/u.test(label)) ||
        (!enumerated && !/\s/u.test(label) && openEnded);
      const previousHasValues = occupied(previous).length > 0;
      const rowHasValues = occupied(row).length > 0;
      if (!overlap && continuation && (previousHasValues || rowHasValues)) {
        previous.cells = previous.cells.map((cell, index) =>
          index === 0 ? joinLines(cell, row.cells[0]!).trim() : cell || row.cells[index]!,
        );
        continue;
      }
    }
    merged.push({ cells: [...row.cells], header: row.header });
  }
  return merged;
}

function finishTable(draft: TableDraft): DocumentNode {
  const columns = tableColumns(draft);
  const width = columns.count + 1;
  const rows: TableRow[] = draft.rows.map((row) => {
    const cells = Array.from({ length: width }, () => "");
    cells[0] = row.label;
    if (row.header) {
      const firstValueColumn = Math.min(
        ...draft.rows.flatMap((entry) => entry.values.map((segment) => segment.x)),
      );
      for (const segment of row.header) {
        if (segment.right < firstValueColumn - draft.fontSize * 3) {
          cells[0] = [cells[0], segment.text].filter(Boolean).join(" ");
          continue;
        }
        const column = columns.locate(segment) + 1;
        cells[column] = [cells[column], segment.text].filter(Boolean).join(" ");
      }
    } else {
      for (const segment of row.values) {
        const column = columns.locate(segment) + 1;
        cells[column] = [cells[column], segment.text].filter(Boolean).join(" ");
      }
    }
    return { cells, header: row.header !== null };
  });
  return { kind: "table", rows: mergeContinuationRows(rows) };
}

/**
 * Ordnet reinen Zahlenzeilen (Label in einer eigenen Zeile darüber oder darunter,
 * wie in Fristigkeitstabellen) das nächstgelegene freie Label zu.
 */
function attachDetachedLabels(items: Classified[]) {
  const result: Classified[] = [];
  const consumed = new Set<number>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "row" && item.label === "") {
      const chosen = [index - 1, index + 1]
        .filter((candidate) => !consumed.has(candidate))
        .map((candidate) => ({ candidate, entry: items[candidate] }))
        .filter(
          (entry): entry is { candidate: number; entry: Extract<Classified, { kind: "label" }> } =>
            entry.entry?.kind === "label" &&
            Math.abs(entry.entry.line.y - item.line.y) <= item.line.fontSize * 1.8,
        )
        .sort(
          (a, b) => Math.abs(a.entry.line.y - item.line.y) - Math.abs(b.entry.line.y - item.line.y),
        )[0];
      if (chosen) {
        consumed.add(chosen.candidate);
        if (chosen.candidate < index) {
          const position = result.lastIndexOf(chosen.entry);
          if (position >= 0) result.splice(position, 1);
        }
        result.push({ ...item, label: chosen.entry.line.text });
        continue;
      }
    }
    if (consumed.has(index)) continue;
    // Umgebrochenes Label: kleingeschriebene Fortsetzung in der Zahlenzeile darunter.
    const next = items[index + 1];
    if (
      item.kind === "label" &&
      next?.kind === "row" &&
      next.label !== "" &&
      /^\p{Ll}/u.test(next.label) &&
      !enumeratedLabelPattern.test(`${next.label} `)
    ) {
      items[index + 1] = { ...next, label: `${item.line.text} ${next.label}` };
      continue;
    }
    result.push(item);
  }
  return result;
}

function headerSegments(line: Line) {
  return (line.segments.length === 1 ? splitUnitRun(line.segments[0]!) : null) ?? line.segments;
}

/** Eine allein stehende Zahl am Seitenrand ist eine Seitenzahl, kein Tabelleninhalt. */
function isPageNumberLine(line: Line, height: number) {
  return (
    (line.y > height * 0.9 || line.y < height * 0.11) &&
    (/^[-–]?\s?\d{1,3}\s?[-–]?$/u.test(line.text) || /^Seite \d+ von \d+$/iu.test(line.text))
  );
}

/** Eine Seite als Folge von Knoten; Kopf- und Fußzeilen sind schon entfernt. */
export function layoutPage(page: PageInput, pageLines: Line[]): DocumentNode[] {
  const nodes: DocumentNode[] = [{ kind: "pageMarker", page: page.pageNumber }];
  if (page.ocr) nodes.push({ kind: "ocrNote" });
  const lines = pageLines.filter((line) => !isPageNumberLine(line, page.height));
  if (lines.length === 0) return nodes;
  // Die Textspalte: wo die meisten langen Zeilen beginnen. Randziffern (Tz) stehen links davon.
  const starts = new Map<number, number>();
  for (const line of lines) {
    if (line.text.length < 40) continue;
    const key = Math.round(line.segments.find((segment) => segment.text.length > 3)?.x ?? 0);
    starts.set(key, (starts.get(key) ?? 0) + 1);
  }
  const bodyX = [...starts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const classified = attachDetachedLabels(lines.map((line) => classify(line, page.width, bodyX)));
  const spacing = median(lines.slice(1).map((line, index) => Math.abs(lines[index]!.y - line.y)));

  type Paragraph = { text: string; y: number; list: boolean; lines: number; tz: boolean };
  let paragraph: Paragraph | null = null;
  let table: TableDraft | null = null;
  let pendingHeaders: Line[] = [];

  const flushParagraph = () => {
    if (!paragraph) return;
    const text = paragraph.text.trim();
    if (text) {
      const level =
        paragraph.list || paragraph.tz || paragraph.lines > 1 ? null : headingLevel(text);
      nodes.push(
        paragraph.list
          ? { kind: "listItem", text }
          : level
            ? { kind: "heading", level, text }
            : { kind: "paragraph", text },
      );
    }
    paragraph = null;
  };
  const flushHeaders = () => {
    for (const header of pendingHeaders) {
      const level = headingLevel(header.text);
      nodes.push(
        level
          ? { kind: "heading", level, text: header.text }
          : { kind: "paragraph", text: header.text },
      );
    }
    pendingHeaders = [];
  };
  const flushTable = () => {
    if (!table) return;
    if (table.rows.some((row) => row.values.length > 0)) nodes.push(finishTable(table));
    else for (const row of table.rows) nodes.push({ kind: "paragraph", text: row.label });
    table = null;
  };

  for (let index = 0; index < classified.length; index += 1) {
    const item = classified[index]!;
    // Folgt nach höchstens fünf Kopf- oder Labelzeilen eine Zahlenzeile?
    let rowFollows = false;
    for (const entry of classified.slice(index + 1, index + 6)) {
      if (entry.kind === "row" && !entry.weak) {
        rowFollows = true;
        break;
      }
      if (entry.kind !== "header" && entry.kind !== "label") break;
    }
    const isRow = item.kind === "row" && (!item.weak || table !== null);
    if (isRow) {
      flushParagraph();
      if (!table) {
        table = { rows: [], fontSize: item.line.fontSize };
        // Titelzeilen vor dem ersten Spaltenkopf gehören nicht in die Tabelle.
        const firstHeader = pendingHeaders.findIndex(
          (header) => classify(header, page.width, bodyX).kind === "header",
        );
        const leading = firstHeader > 0 ? pendingHeaders.splice(0, firstHeader) : [];
        const heldHeaders = pendingHeaders;
        pendingHeaders = leading;
        flushHeaders();
        pendingHeaders = heldHeaders;
        for (const header of pendingHeaders) {
          const kind = classify(header, page.width, bodyX).kind;
          table.rows.push(
            kind === "header"
              ? { label: "", values: [], header: header.segments }
              : { label: header.text, values: [], header: null },
          );
        }
        pendingHeaders = [];
      }
      table.rows.push({ label: item.label, values: item.values, header: null });
      continue;
    }
    if ((item.kind === "header" || item.kind === "label") && (table || rowFollows)) {
      if (table) {
        table.rows.push(
          item.kind === "header"
            ? { label: "", values: [], header: headerSegments(item.line) }
            : { label: item.line.text, values: [], header: null },
        );
      } else {
        flushParagraph();
        pendingHeaders.push(item.line);
      }
      continue;
    }
    flushTable();
    flushHeaders();
    const gap = paragraph ? Math.abs(paragraph.y - item.line.y) : 0;
    const startsHeading =
      (item.kind === "text" || item.kind === "label") && headingLevel(item.line.text) !== null;
    const newBlock =
      !paragraph ||
      item.kind === "bullet" ||
      item.kind === "tz" ||
      gap > Math.max(spacing * 1.45, item.line.fontSize * 1.9) ||
      startsHeading ||
      (!paragraph.tz && paragraph.lines === 1 && headingLevel(paragraph.text) !== null);
    if (newBlock) {
      flushParagraph();
      const text =
        item.kind === "tz"
          ? `${item.number} ${item.text}`
          : item.kind === "bullet"
            ? item.text
            : item.line.text;
      paragraph = {
        text,
        y: item.line.y,
        list: item.kind === "bullet",
        lines: 1,
        tz: item.kind === "tz",
      };
    } else {
      const current: Paragraph = paragraph!;
      current.text = joinLines(current.text, item.line.text);
      current.y = item.line.y;
      current.lines += 1;
    }
  }
  flushParagraph();
  flushTable();
  flushHeaders();
  return nodes;
}

/** Alle Seiten: Zeilen bilden, Kopf- und Fußzeilen entfernen, Seiten layouten. */
export function layoutDocument(pages: readonly PageInput[]): DocumentNode[] {
  const lined = pages.map((page) => ({ page, lines: buildLines(page.items) }));
  const repeated = repeatedMarginTexts(
    lined.map(({ page, lines }) => ({ lines, height: page.height })),
  );
  return lined.flatMap(({ page, lines }) =>
    layoutPage(
      page,
      lines.filter((line) => !(inMargin(line, page.height) && repeated.has(marginKey(line.text)))),
    ),
  );
}
