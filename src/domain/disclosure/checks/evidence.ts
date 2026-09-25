import { abs, compareWithTolerance, microPerUnit } from "../arithmetic";
import { postenOfAccount } from "../susa";

import { formatAmount, formatDifference } from "./comments";
import { postenOfRowLabel } from "./posten";
import { isAmountColumn, type TableModel } from "./tables";
import type { CheckDraft, EngineFigure } from "./types";

/**
 * Beleg-Abgleich: die Summe der Salden aller SuSa-Konten, die einem Posten zugeordnet
 * sind, gegen jede Tabellenzahl dieses Postens im Berichtsjahr. Verglichen wird der
 * Betrag, weil eine SuSa Haben-Salden negativ führt und die Bilanz sie positiv zeigt.
 * Die Toleranz ist wie überall eine Anzeigeeinheit der gröberen Darstellung.
 *
 * Gelesen werden die Tabellenzeilen selbst, auch Vorspalten: in einer HGB-Bilanz steht
 * „Forderungen aus Lieferungen und Leistungen“ oft in der Vorspalte, die Zwischensumme
 * rechts daneben. Abweichend gegliederte Tabellen bleiben außen vor.
 */

export type EvidenceAccountInput = Readonly<{
  id: string;
  accountNumber: string;
  label: string;
  closing: bigint;
}>;

export type EvidenceFileInput = Readonly<{
  id: string;
  accounts: readonly EvidenceAccountInput[];
}>;

const cent = microPerUnit / 100n;
const euro = { unit: "EUR" as const, scale: 1, decimals: 2 };

/** „SuSa Konto 1200 · Forderungen aus L+L · 933.929,51 EUR“ bzw. „SuSa Konten 1800, 1810 · …“. */
export function evidenceSourceLabel(
  accounts: readonly EvidenceAccountInput[],
  total: bigint,
  postenLabel: string,
) {
  const numbers = accounts.map((account) => account.accountNumber);
  const head =
    accounts.length === 1
      ? `SuSa Konto ${numbers[0]} · ${accounts[0]!.label}`
      : `SuSa Konten ${numbers.slice(0, 4).join(", ")}${numbers.length > 4 ? " …" : ""} · ${postenLabel}`;
  return `${head} · ${formatAmount(total, euro)}`;
}

/** Je Posten die Zahlen des Berichtsjahres in EUR aus den Tabellenzeilen. */
function tableFiguresByPosten(tables: readonly TableModel[]) {
  const byPosten = new Map<string, EngineFigure[]>();
  for (const table of tables) {
    if (table.alternate) continue;
    for (const row of table.rows) {
      if (row.davon) continue;
      for (const [columnIndex, cell] of row.cells) {
        const figure = cell.figure;
        const column = table.columns.get(columnIndex);
        if (!figure || figure.micro === null || figure.issue || figure.unit !== "EUR") continue;
        if (!column || !isAmountColumn(column) || column.change) continue;
        if ((figure.period ?? column.period) !== "current") continue;
        const label = table.labels.get(figure.id)?.label ?? row.label;
        const posten = postenOfRowLabel(label);
        if (!posten) continue;
        const list = byPosten.get(posten.key) ?? [];
        list.push(figure);
        byPosten.set(posten.key, list);
      }
    }
  }
  return byPosten;
}

export function evidenceChecks(
  tables: readonly TableModel[],
  files: readonly EvidenceFileInput[],
): CheckDraft[] {
  if (files.length === 0) return [];
  const figuresByPosten = tableFiguresByPosten(tables);
  const drafts: CheckDraft[] = [];
  for (const file of files) {
    const groups = new Map<string, { label: string; accounts: EvidenceAccountInput[] }>();
    for (const account of file.accounts) {
      const posten = postenOfAccount(account.label);
      if (!posten) continue;
      const group = groups.get(posten.key) ?? { label: posten.label, accounts: [] };
      group.accounts.push(account);
      groups.set(posten.key, group);
    }
    for (const [key, group] of groups) {
      const total = group.accounts.reduce((sum, account) => sum + account.closing, 0n);
      const figures = figuresByPosten.get(key) ?? [];
      const sourceLabel = evidenceSourceLabel(group.accounts, total, group.label);
      const shortSource =
        group.accounts.length === 1
          ? `SuSa Konto ${group.accounts[0]!.accountNumber}`
          : `SuSa Konten ${group.accounts
              .map((account) => account.accountNumber)
              .slice(0, 3)
              .join(", ")}`;
      for (const figure of figures) {
        const actual = figure.micro!;
        const comparison = compareWithTolerance(
          { micro: abs(actual), displayUnit: figure.displayUnit },
          { micro: abs(total), displayUnit: cent },
        );
        const expected = actual < 0n ? -abs(total) : abs(total);
        const format = { unit: figure.unit, scale: figure.scale, decimals: figure.decimals };
        drafts.push({
          kind: "evidence",
          status: comparison.status,
          subjectFigureId: figure.id,
          subjectStatementId: null,
          actual,
          expected,
          tolerance: comparison.tolerance,
          rounded: comparison.rounded,
          sourceKind: "evidence",
          sourceFigureIds: [],
          sourceBlockIds: [],
          sourceAccountIds: group.accounts.map((account) => account.id),
          sourceLabel,
          comment: {
            code: comparison.status === "match" ? "evidence_matches" : "evidence_differs",
            params: {
              source: shortSource.slice(0, 60),
              expected: formatAmount(expected, format),
              difference: formatDifference(comparison.difference, format),
              label: group.label,
              rounded: comparison.rounded ? "1" : "0",
            },
          },
          assignment: "rule",
          confidenceBp: null,
          sourceKey: `evidence:${file.id}:${key}`,
          subjectLabel: group.label,
        });
      }
    }
  }
  return drafts;
}
