import type { ContextInputBlock } from "./document-context";

/**
 * Inhaltsverzeichnisse eines Berichts. Ihre Seitenzahlen („Prüfungsauftrag 4“) sind
 * keine Berichtszahlen und werden weder erkannt noch markiert. Ein Verzeichnis beginnt
 * mit seiner Überschrift oder ist eine Folge von mindestens vier Einträgen mit
 * aufsteigenden Seitenzahlen; es endet am ersten Block, der kein Eintrag ist.
 */

const tocTitle =
  /^(?:Inhaltsverzeichnis|Inhaltsübersicht|Inhalt|Gliederung|Anlagenverzeichnis|Table of contents|Contents)\s*:?$/iu;
const pageLabel = /^(?:Seite|Seiten|S\.|Page|Blatt)$/iu;
/** „A. Prüfungsauftrag 4“, „2.1 Buchführung ........ 15“; keine Beträge, keine Sätze. */
const tocEntry =
  /^(?:(?:[A-H]|[IVX]{1,4}|\d{1,2}(?:\.\d{1,2})*)[.)]?\s+)?\p{L}[^\n]{0,160}?(?:\s*[.·…_]{2,}\s*|\s+)(\d{1,3})$/u;
const amountWord = /\b(?:T?EUR|Mio\.?|Mrd\.?|Tsd\.?)\b|€|%/u;
const minimumRun = 4;

/** Seitenzahlen der Einträge eines Blocks; `null`, wenn eine Zeile kein Eintrag ist. */
function entryPages(text: string): number[] | null {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const pages: number[] = [];
  for (const line of lines) {
    if (pageLabel.test(line)) continue;
    const match = tocEntry.exec(line);
    if (!match || amountWord.test(line)) return null;
    pages.push(Number(match[1]));
  }
  return pages.length > 0 ? pages : null;
}

function ascending(pages: readonly number[]) {
  return pages.every((page, index) => index === 0 || page >= pages[index - 1]!);
}

/**
 * Tabellen, die nur aus Text und einer Spalte aufsteigender Seitenzahlen bestehen.
 * Der Konverter legt ein zweispaltig gesetztes Verzeichnis als Tabelle an.
 */
function pageNumberTables(blocks: readonly ContextInputBlock[]) {
  const tables = new Map<number, ContextInputBlock[]>();
  for (const block of blocks) {
    if (!block.cell) continue;
    const list = tables.get(block.cell.table) ?? [];
    list.push(block);
    tables.set(block.cell.table, list);
  }
  const found = new Set<number>();
  for (const [index, cells] of tables) {
    const values = cells
      .filter((cell) => cell.cell!.column > 0 && cell.text.trim() !== "")
      .sort((a, b) => a.cell!.row - b.cell!.row);
    const pages = values
      .filter((cell) => !pageLabel.test(cell.text.trim()))
      .map((cell) => cell.text.trim());
    if (pages.length < minimumRun || !pages.every((text) => /^\d{1,3}$/u.test(text))) continue;
    const rows = new Set(values.map((cell) => cell.cell!.row));
    if (rows.size !== values.length) continue;
    if (ascending(pages.map(Number))) found.add(index);
  }
  return found;
}

/** Die Blöcke aller Inhaltsverzeichnisse, einschließlich ihrer Überschrift. */
export function tableOfContentsBlockIds(blocks: readonly ContextInputBlock[]) {
  const ids = new Set<string>();
  const tables = pageNumberTables(blocks);
  const tocTables = new Set<number>(tables);
  let open = false;
  /** Letzte Seitenzahl des offenen Verzeichnisses; eine kleinere beendet es. */
  let lastPage = 0;
  let run: string[] = [];
  let runPages: number[] = [];

  const closeRun = () => {
    if (run.length >= minimumRun && ascending(runPages)) run.forEach((id) => ids.add(id));
    run = [];
    runPages = [];
  };

  for (const block of blocks) {
    const text = block.text.trim();
    if (/^PDF-Seite \d+$|^per Texterkennung gelesen$/u.test(text) || text === "") continue;
    if (block.cell) {
      if (open) tocTables.add(block.cell.table);
      if (tocTables.has(block.cell.table)) {
        ids.add(block.id);
        continue;
      }
      open = false;
      closeRun();
      continue;
    }
    if (tocTitle.test(text)) {
      closeRun();
      open = true;
      lastPage = 0;
      ids.add(block.id);
      continue;
    }
    if (pageLabel.test(text) && (open || run.length > 0)) {
      ids.add(block.id);
      continue;
    }
    const pages = entryPages(text);
    if (open && pages && (pages[0]! < lastPage || !ascending(pages))) open = false;
    if (!pages) {
      open = false;
      closeRun();
      continue;
    }
    if (open) {
      ids.add(block.id);
      lastPage = pages.at(-1)!;
      continue;
    }
    // Mehrzeiliger Block, der selbst ein Verzeichnis ist.
    if (pages.length >= minimumRun && ascending(pages)) {
      ids.add(block.id);
      continue;
    }
    if (runPages.length > 0 && pages[0]! < runPages.at(-1)!) closeRun();
    run.push(block.id);
    runPages.push(...pages);
  }
  closeRun();
  return ids;
}
