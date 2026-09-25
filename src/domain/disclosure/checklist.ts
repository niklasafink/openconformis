/**
 * Checklisten der Vollständigkeitsprüfung: Positionen, ihre Validierung und ihr
 * Excel-Format. Rein und ohne Infrastruktur; dieselben Regeln gelten für den
 * Excel-Import der Vorlagen, den Demo-Seed und die Bearbeitung eigener Checklisten.
 *
 * Excel-Format (ein Blatt, erste Zeile Kopfzeile):
 *
 *   Schlüssel | Referenz | Titel | Anforderung | Prüfaspekte | Übergeordnet | Reihenfolge
 *
 * Prüfaspekte sind durch `;` getrennt, „Übergeordnet“ nennt den Schlüssel der
 * übergeordneten Position, „Reihenfolge“ ist eine ganze Zahl (leer = Zeilenfolge).
 */

export type ChecklistItemInput = {
  externalKey: string;
  reference: string;
  title: string;
  requirement: string;
  aspects: string[];
  parentKey: string | null;
  displayOrder: number;
};

export type ChecklistIssueCode =
  | "missing_header"
  | "no_items"
  | "too_many_items"
  | "invalid_key"
  | "duplicate_key"
  | "empty_reference"
  | "empty_title"
  | "empty_requirement"
  | "text_too_long"
  | "unknown_parent"
  | "self_parent"
  | "parent_cycle"
  | "too_deep"
  | "invalid_order";

export type ChecklistIssue = {
  /** Excel-Zeile (1 = Kopfzeile), bei Positionen ohne Zeile deren Reihenfolge. */
  row: number | null;
  key: string | null;
  code: ChecklistIssueCode;
};

export const checklistLimits = {
  maximumItems: 500,
  maximumDepth: 3,
  keyPattern: /^[\p{L}\p{N}][\p{L}\p{N}._\-/ ]{0,79}$/u,
  reference: 200,
  title: 300,
  requirement: 6_000,
  aspect: 500,
  aspects: 20,
} as const;

/** Spalten der Kopfzeile, deutsch oder englisch, ohne Groß-/Kleinschreibung. */
const headerAliases = {
  externalKey: ["schlüssel", "schluessel", "key"],
  reference: ["referenz", "reference", "fundstelle"],
  title: ["titel", "title"],
  requirement: ["anforderung", "requirement", "angabepflicht"],
  aspects: ["prüfaspekte", "pruefaspekte", "prüfaspekte (;)", "aspects", "assessment aspects"],
  parentKey: ["übergeordnet", "uebergeordnet", "parent", "übergeordnete position"],
  displayOrder: ["reihenfolge", "order", "sortierung"],
} as const;

type Column = keyof typeof headerAliases;

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function clean(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

export function splitAspects(value: string) {
  return value
    .split(";")
    .map((aspect) => clean(aspect))
    .filter(Boolean);
}

/**
 * Liest die Zeilen eines Excel-Blatts (bereits als Text) in Positionen. Die Kopfzeile
 * muss die Pflichtspalten Schlüssel, Referenz, Titel und Anforderung tragen; leere
 * Zeilen werden übersprungen. Validiert wird danach mit `validateChecklistItems`.
 */
export function parseChecklistRows(rows: ReadonlyArray<ReadonlyArray<string>>): {
  items: Array<ChecklistItemInput & { row: number }>;
  issues: ChecklistIssue[];
} {
  const header = rows[0] ?? [];
  const index = new Map<Column, number>();
  header.forEach((cell, position) => {
    const name = normalizeHeader(cell);
    for (const [column, aliases] of Object.entries(headerAliases) as [
      Column,
      readonly string[],
    ][]) {
      if (!index.has(column) && aliases.includes(name)) index.set(column, position);
    }
  });
  const required: Column[] = ["externalKey", "reference", "title", "requirement"];
  if (required.some((column) => !index.has(column))) {
    return { items: [], issues: [{ row: 1, key: null, code: "missing_header" }] };
  }
  const issues: ChecklistIssue[] = [];
  const items: Array<ChecklistItemInput & { row: number }> = [];
  const read = (row: ReadonlyArray<string>, column: Column) => {
    const position = index.get(column);
    return position === undefined ? "" : (row[position] ?? "");
  };
  rows.slice(1).forEach((row, offset) => {
    const excelRow = offset + 2;
    if (row.every((cell) => !clean(cell))) return;
    const orderText = clean(read(row, "displayOrder"));
    let displayOrder = items.length + 1;
    if (orderText) {
      const parsed = Number(orderText.replace(",", "."));
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
        issues.push({
          row: excelRow,
          key: clean(read(row, "externalKey")) || null,
          code: "invalid_order",
        });
      } else {
        displayOrder = parsed;
      }
    }
    items.push({
      row: excelRow,
      externalKey: clean(read(row, "externalKey")),
      reference: clean(read(row, "reference")),
      title: clean(read(row, "title")),
      requirement: read(row, "requirement").trim(),
      aspects: splitAspects(read(row, "aspects")),
      parentKey: clean(read(row, "parentKey")) || null,
      displayOrder,
    });
  });
  return { items, issues };
}

/**
 * Prüft Positionen wie das Veröffentlichen eines Rahmenwerks: eindeutige, gültige
 * Schlüssel, keine leeren Texte, bekannte Eltern ohne Zyklus und höchstens drei Ebenen.
 */
export function validateChecklistItems(
  items: ReadonlyArray<ChecklistItemInput & { row?: number }>,
): ChecklistIssue[] {
  const issues: ChecklistIssue[] = [];
  const at = (item: ChecklistItemInput & { row?: number }) => item.row ?? item.displayOrder;
  if (items.length === 0) return [{ row: null, key: null, code: "no_items" }];
  if (items.length > checklistLimits.maximumItems) {
    issues.push({ row: null, key: null, code: "too_many_items" });
  }
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.externalKey;
    if (!checklistLimits.keyPattern.test(key)) {
      issues.push({ row: at(item), key: key || null, code: "invalid_key" });
    } else if (seen.has(key.toLowerCase())) {
      issues.push({ row: at(item), key, code: "duplicate_key" });
    }
    seen.add(key.toLowerCase());
    if (!item.reference.trim()) issues.push({ row: at(item), key, code: "empty_reference" });
    if (!item.title.trim()) issues.push({ row: at(item), key, code: "empty_title" });
    if (!item.requirement.trim()) issues.push({ row: at(item), key, code: "empty_requirement" });
    if (
      item.reference.length > checklistLimits.reference ||
      item.title.length > checklistLimits.title ||
      item.requirement.length > checklistLimits.requirement ||
      item.aspects.length > checklistLimits.aspects ||
      item.aspects.some((aspect) => aspect.length > checklistLimits.aspect)
    ) {
      issues.push({ row: at(item), key, code: "text_too_long" });
    }
  }
  const byKey = new Map(items.map((item) => [item.externalKey.toLowerCase(), item]));
  for (const item of items) {
    if (!item.parentKey) continue;
    const parentKey = item.parentKey.toLowerCase();
    if (parentKey === item.externalKey.toLowerCase()) {
      issues.push({ row: at(item), key: item.externalKey, code: "self_parent" });
      continue;
    }
    if (!byKey.has(parentKey)) {
      issues.push({ row: at(item), key: item.externalKey, code: "unknown_parent" });
      continue;
    }
    // Aufwärts bis zur Wurzel: ein Zyklus oder mehr als drei Ebenen.
    let depth = 1;
    let current: (ChecklistItemInput & { row?: number }) | undefined = byKey.get(parentKey);
    const visited = new Set([item.externalKey.toLowerCase()]);
    while (current?.parentKey) {
      const next = current.parentKey.toLowerCase();
      if (visited.has(next)) {
        issues.push({ row: at(item), key: item.externalKey, code: "parent_cycle" });
        depth = -1;
        break;
      }
      visited.add(current.externalKey.toLowerCase());
      depth += 1;
      current = byKey.get(next);
    }
    if (depth >= checklistLimits.maximumDepth) {
      issues.push({ row: at(item), key: item.externalKey, code: "too_deep" });
    }
  }
  return issues;
}

export type OrderedChecklistItem<T extends ChecklistItemInput> = T & { depth: number };

/**
 * Anzeige- und Prüfreihenfolge: Wurzeln nach Reihenfolge, jede Unterposition direkt
 * unter ihrer übergeordneten Position. Setzt gültige Positionen voraus.
 */
export function orderChecklistItems<T extends ChecklistItemInput>(
  items: readonly T[],
): OrderedChecklistItem<T>[] {
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  const keys = new Set(items.map((item) => item.externalKey.toLowerCase()));
  for (const item of items) {
    const parent = item.parentKey?.toLowerCase();
    if (parent && keys.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(item);
      children.set(parent, list);
    } else {
      roots.push(item);
    }
  }
  const byOrder = (a: T, b: T) =>
    a.displayOrder - b.displayOrder || a.externalKey.localeCompare(b.externalKey, "de");
  const result: OrderedChecklistItem<T>[] = [];
  const visit = (item: T, depth: number) => {
    result.push({ ...item, depth });
    for (const child of [...(children.get(item.externalKey.toLowerCase()) ?? [])].sort(byOrder)) {
      if (depth < checklistLimits.maximumDepth) visit(child, depth + 1);
    }
  };
  for (const root of [...roots].sort(byOrder)) visit(root, 0);
  return result;
}

/** Die Felder, die eine Position fachlich ausmachen, in fester Reihenfolge für Hashes. */
export function checklistItemContent(item: ChecklistItemInput) {
  return {
    externalKey: item.externalKey,
    reference: item.reference,
    title: item.title,
    requirement: item.requirement,
    aspects: item.aspects,
    parentKey: item.parentKey,
  };
}
