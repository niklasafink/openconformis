import { describe, expect, it } from "vitest";

import {
  orderChecklistItems,
  parseChecklistRows,
  validateChecklistItems,
  type ChecklistItemInput,
} from "./checklist";
import { demoChecklistItems } from "./checklist-demo";

const header = [
  "Schlüssel",
  "Referenz",
  "Titel",
  "Anforderung",
  "Prüfaspekte (;)",
  "Übergeordnet",
  "Reihenfolge",
];

function rows(...body: string[][]) {
  return [header, ...body];
}

function codesOf(input: string[][]) {
  const parsed = parseChecklistRows(input);
  // Ohne Kopfzeile gibt es nichts weiter zu prüfen, so wie beim Import.
  const header = parsed.issues.some((issue) => issue.code === "missing_header");
  return [...parsed.issues, ...(header ? [] : validateChecklistItems(parsed.items))].map(
    (issue) => [issue.row, issue.code],
  );
}

describe("Excel-Import einer Checklistenvorlage", () => {
  it("liest Positionen mit Prüfaspekten, Eltern und Reihenfolge", () => {
    const parsed = parseChecklistRows(
      rows(
        [
          "A-1",
          "§ 285 Nr. 7 HGB",
          "Arbeitnehmer",
          "Zahl der Arbeitnehmer.",
          "Durchschnitt; Gruppen",
          "",
          "2",
        ],
        ["A-0", "§ 284 HGB", "Methoden", "Methoden angeben.", "", "", "1"],
        ["A-1-a", "§ 285 Nr. 7 HGB", "Gruppen", "Nach Gruppen.", "", "A-1", ""],
        ["", "", "", "", "", "", ""],
      ),
    );
    expect(parsed.issues).toEqual([]);
    expect(validateChecklistItems(parsed.items)).toEqual([]);
    expect(parsed.items[0]).toMatchObject({
      externalKey: "A-1",
      aspects: ["Durchschnitt", "Gruppen"],
      parentKey: null,
      displayOrder: 2,
      row: 2,
    });
    expect(orderChecklistItems(parsed.items).map((item) => [item.externalKey, item.depth])).toEqual(
      [
        ["A-0", 0],
        ["A-1", 0],
        ["A-1-a", 1],
      ],
    );
  });

  it("verlangt die Pflichtspalten der Kopfzeile", () => {
    expect(
      codesOf([
        ["Schlüssel", "Titel"],
        ["A", "B"],
      ]),
    ).toEqual([[1, "missing_header"]]);
  });

  it("weist doppelte Schlüssel ab, auch in anderer Schreibweise", () => {
    expect(
      codesOf(
        rows(
          ["A-1", "§ 1", "Titel", "Text.", "", "", ""],
          ["a-1", "§ 2", "Titel", "Text.", "", "", ""],
        ),
      ),
    ).toEqual([[3, "duplicate_key"]]);
  });

  it("weist leere Referenz, leeren Titel und leere Anforderung ab", () => {
    expect(
      codesOf(
        rows(
          ["A-1", "", "Titel", "Text.", "", "", ""],
          ["A-2", "§ 2", "  ", "Text.", "", "", ""],
          ["A-3", "§ 3", "Titel", " ", "", "", ""],
        ),
      ),
    ).toEqual([
      [2, "empty_reference"],
      [3, "empty_title"],
      [4, "empty_requirement"],
    ]);
  });

  it("weist unbekannte Eltern, Selbstbezug und Zyklen ab", () => {
    expect(
      codesOf(
        rows(
          ["A-1", "§ 1", "Titel", "Text.", "", "GIBT-ES-NICHT", ""],
          ["A-2", "§ 2", "Titel", "Text.", "", "A-2", ""],
          ["A-3", "§ 3", "Titel", "Text.", "", "A-4", ""],
          ["A-4", "§ 4", "Titel", "Text.", "", "A-3", ""],
        ),
      ),
    ).toEqual([
      [2, "unknown_parent"],
      [3, "self_parent"],
      [4, "parent_cycle"],
      [5, "parent_cycle"],
    ]);
  });

  it("weist eine ungültige Reihenfolge und einen ungültigen Schlüssel ab", () => {
    expect(
      codesOf(
        rows(
          ["A-1", "§ 1", "Titel", "Text.", "", "", "zwei"],
          ["-X", "§ 2", "Titel", "Text.", "", "", ""],
        ),
      ),
    ).toEqual([
      [2, "invalid_order"],
      [3, "invalid_key"],
    ]);
  });

  it("verlangt mindestens eine Position", () => {
    expect(codesOf(rows())).toEqual([[null, "no_items"]]);
  });
});

describe("Demo-Vorlage", () => {
  it("ist gültig und hat 10 bis 15 Positionen mit einer Unterebene", () => {
    const items: ChecklistItemInput[] = [...demoChecklistItems];
    expect(validateChecklistItems(items)).toEqual([]);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.length).toBeLessThanOrEqual(15);
    const ordered = orderChecklistItems(items);
    expect(ordered.filter((item) => item.depth === 1).map((item) => item.externalKey)).toEqual([
      "HGB-285-9-A",
      "HGB-285-9-C",
    ]);
    expect(ordered.findIndex((item) => item.externalKey === "HGB-285-9-A")).toBe(
      ordered.findIndex((item) => item.externalKey === "HGB-285-9") + 1,
    );
  });
});
