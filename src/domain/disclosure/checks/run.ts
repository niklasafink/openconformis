import {
  buildFacts,
  createResolver,
  factSourceLabel,
  formulaByKey,
  agree,
  type Fact,
} from "./facts";
import { formatAmount, formatDifference } from "./comments";
import { evidenceChecks, type EvidenceFileInput } from "./evidence";
import { normalizeLabel, postenByKey } from "./posten";
import {
  balanceChecks,
  buildTables,
  changeColumnChecks,
  horizontalChecks,
  tableSumChecks,
  type TableModel,
} from "./tables";
import { referenceCheck, textChecks, type PendingMention } from "./text";
import { compareWithTolerance, abs } from "../arithmetic";
import type { CheckDraft, EngineDocument } from "./types";

/**
 * Alle deterministischen Prüfungen eines Berichts. Rein und reproduzierbar: dieselben
 * erkannten Zahlen ergeben dieselben Prüfungen in derselben Reihenfolge. Doppelte
 * Prüfungen (gleiche Art, gleicher Gegenstand, gleiche Quelle) werden zusammengelegt.
 */
export function runDeterministicChecks(
  document: EngineDocument,
  /** Belegdateien des Laufs (SuSa); ohne sie gibt es keinen Beleg-Abgleich. */
  evidence: readonly EvidenceFileInput[] = [],
) {
  const tables = buildTables(document);
  const tableDrafts: CheckDraft[] = [];
  for (const table of tables) {
    tableDrafts.push(
      ...tableSumChecks(table),
      ...horizontalChecks(table),
      ...changeColumnChecks(table),
    );
  }
  tableDrafts.push(...balanceChecks(tables));
  const confirmed = new Map(
    tableDrafts
      .filter(
        (draft) =>
          draft.status === "match" &&
          draft.subjectFigureId &&
          (draft.kind === "table_sum" || draft.kind === "horizontal_sum"),
      )
      .map((draft) => [draft.subjectFigureId!, draft.sourceFigureIds.length] as const),
  );
  const index = buildFacts(tables, confirmed);
  const resolver = createResolver(index);
  const referenceDrafts = [
    ...tableReferenceChecks(index.byPosten),
    ...derivedRowChecks(index.facts, resolver),
    ...evidenceChecks(tables, evidence),
  ];
  const factLabels = uniqueLabels(index.facts);
  const text = textChecks(document, resolver, factLabels);
  const drafts = dedupe([...tableDrafts, ...referenceDrafts, ...text.drafts]);
  labelSubjects(drafts, document, tables);
  return { drafts, pending: text.pending, tables, resolver, factLabels };
}

/** Titel-Label je Prüfung: Zeilenlabel einer Tabellenzahl, sonst der Posten oder das Wort. */
function labelSubjects(
  drafts: CheckDraft[],
  document: EngineDocument,
  tables: readonly TableModel[],
) {
  const tableLabel = new Map<string, string>();
  for (const table of tables) {
    for (const [figureId, entry] of table.labels) {
      // „Summe“ allein sagt nichts: dann die Überschrift der Tabelle.
      const label = /^(?:Summe|Gesamt|Insgesamt|Zwischensumme)$/iu.test(entry.label)
        ? table.caption
          ? normalizeLabel(table.caption)
          : entry.label
        : entry.label;
      if (label) tableLabel.set(figureId, label);
    }
  }
  const statements = new Map(document.statements.map((statement) => [statement.id, statement.raw]));
  for (const draft of drafts) {
    if (draft.subjectLabel) continue;
    const label =
      (draft.subjectFigureId ? tableLabel.get(draft.subjectFigureId) : undefined) ??
      draft.comment.params.label ??
      (draft.subjectStatementId ? statements.get(draft.subjectStatementId) : undefined) ??
      null;
    draft.subjectLabel = label && draft.kind === "prior_year" ? `${label} (Vorjahr)` : label;
  }
}

function uniqueLabels(facts: readonly Fact[]) {
  const seen = new Map<string, string>();
  for (const fact of facts) {
    const key = fact.posten?.key ?? `label:${fact.label.toLowerCase()}`;
    if (!seen.has(key) && fact.label.length >= 4) seen.set(key, fact.posten?.label ?? fact.label);
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

/** Derselbe Posten in zwei Tabellen: die genaueste, bestätigte Zahl ist der Soll-Wert. */
function tableReferenceChecks(byPosten: Map<string, Fact[]>): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  for (const [key, facts] of byPosten) {
    const posten = postenByKey.get(key);
    if (!posten) continue;
    for (const period of ["current", "prior"] as const) {
      const candidates = facts.filter(
        (fact) => fact.period === period && fact.figure.unit === "EUR",
      );
      if (new Set(candidates.map((fact) => fact.table.id)).size < 2) continue;
      const ranked = [...candidates].sort(
        (a, b) =>
          Number(a.table.alternate) - Number(b.table.alternate) ||
          Number(a.relabeled) - Number(b.relabeled) ||
          Number(b.confirmed) - Number(a.confirmed) ||
          (a.figure.displayUnit < b.figure.displayUnit
            ? -1
            : a.figure.displayUnit > b.figure.displayUnit
              ? 1
              : 0),
      );
      const reference = ranked[0]!;
      for (const fact of ranked.slice(1)) {
        if (fact.table.id === reference.table.id) continue;
        const magnitude = posten.kind === "expense";
        const left = {
          micro: magnitude ? abs(fact.figure.micro!) : fact.figure.micro!,
          displayUnit: fact.figure.displayUnit,
        };
        const right = {
          micro: magnitude ? abs(reference.figure.micro!) : reference.figure.micro!,
          displayUnit: reference.figure.displayUnit,
        };
        // Eine Summe aus n gerundeten Posten darf um n Einheiten abweichen.
        const comparison = compareWithTolerance(
          left,
          right,
          Math.max(fact.terms, reference.terms, 1),
        );
        const signOnly = !magnitude && comparison.status !== "match" && agree(left, right, true);
        // „Fristigkeitsgliederung der Forderungen an Kreditinstitute“ zeigt nur den
        // Unterposten „b) sonstige Forderungen“: dann ist die Summe ein Teil, keine Abweichung.
        if (comparison.status !== "match" && (fact.viaCaption || reference.viaCaption)) {
          const [part, whole] = fact.viaCaption ? [fact, reference] : [reference, fact];
          if (equalsChild(part, whole)) continue;
        }
        let status: CheckDraft["status"] = comparison.status;
        let code: CheckDraft["comment"]["code"] =
          comparison.status === "match"
            ? "reference_matches"
            : signOnly
              ? "reference_sign"
              : "reference_differs";
        if (comparison.status !== "match" && (fact.table.alternate || reference.table.alternate)) {
          status = "uncertain";
          code = "reference_structure";
        } else if (comparison.status !== "match" && (fact.relabeled || reference.relabeled)) {
          status = "uncertain";
          code = "reference_candidates";
        }
        const format = {
          unit: fact.figure.unit,
          scale: fact.figure.scale,
          decimals: fact.figure.decimals,
        };
        const sourceLabel = factSourceLabel(reference);
        drafts.push({
          kind: period === "prior" ? "prior_year" : "cross_reference",
          status,
          subjectFigureId: fact.figure.id,
          subjectStatementId: null,
          actual: fact.figure.micro,
          expected: reference.figure.micro,
          tolerance: comparison.tolerance,
          rounded: comparison.rounded,
          sourceKind: "table",
          sourceFigureIds: [reference.figure.id],
          sourceBlockIds: [],
          sourceLabel,
          comment: {
            code,
            params: {
              source: sourceLabel.slice(0, 70),
              expected: formatAmount(reference.figure.micro!, format),
              difference: formatDifference(comparison.difference, format),
              label: posten.label,
              rounded: comparison.rounded ? "1" : "0",
            },
          },
          assignment: "rule",
          confidenceBp: null,
          sourceKey: `table-ref:${reference.figure.id}`,
        });
      }
    }
  }
  return drafts;
}

/** Tabellenzeilen abgeleiteter Posten („I. NETTOZINSERTRAG“) gegen ihre Code-Formel. */
function derivedRowChecks(
  facts: readonly Fact[],
  resolver: ReturnType<typeof createResolver>,
): CheckDraft[] {
  const drafts: CheckDraft[] = [];
  for (const fact of facts) {
    if (!fact.posten || fact.figure.unit !== "EUR") continue;
    const formula = formulaByKey.get(fact.posten.key);
    if (!formula || formula.unit !== "EUR") continue;
    const computed = formula.compute((key) => resolver.resolve(key, fact.period));
    if (!computed) continue;
    const comparison = compareWithTolerance(
      { micro: fact.figure.micro!, displayUnit: fact.figure.displayUnit },
      { micro: computed.micro, displayUnit: computed.displayUnit },
      2,
    );
    const format = {
      unit: fact.figure.unit,
      scale: fact.figure.scale,
      decimals: fact.figure.decimals,
    };
    drafts.push({
      kind: "derived",
      status: comparison.status,
      subjectFigureId: fact.figure.id,
      subjectStatementId: null,
      actual: fact.figure.micro,
      expected: computed.micro,
      tolerance: comparison.tolerance,
      rounded: comparison.rounded,
      sourceKind: "formula",
      sourceFigureIds: computed.sources.map((source) => source.id),
      sourceBlockIds: [],
      sourceLabel: computed.formula,
      comment: {
        code: comparison.status === "match" ? "derived_matches" : "derived_differs",
        params: {
          formula: computed.formula,
          expected: formatAmount(computed.micro, format),
          difference: formatDifference(comparison.difference, format),
          rounded: comparison.rounded ? "1" : "0",
        },
      },
      assignment: "rule",
      confidenceBp: null,
      sourceKey: `formula:${formula.key}`,
    });
  }
  return drafts;
}

function equalsChild(part: Fact, whole: Fact) {
  const rows = whole.table.rows;
  const level = whole.row.level;
  for (const row of rows.slice(whole.row.index + 1)) {
    if (level === null || row.level === null || row.level <= level) break;
    for (const cell of row.cells.values()) {
      const figure = cell.figure;
      if (!figure || figure.micro === null || figure.period !== part.figure.period) continue;
      if (
        agree(
          { micro: figure.micro, displayUnit: figure.displayUnit },
          { micro: part.figure.micro!, displayUnit: part.figure.displayUnit },
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function dedupe(drafts: CheckDraft[]) {
  const seen = new Map<string, CheckDraft>();
  for (const draft of drafts) {
    const key = `${draft.kind}|${draft.subjectFigureId ?? draft.subjectStatementId}|${draft.sourceKey}`;
    if (!seen.has(key)) seen.set(key, draft);
  }
  return [...seen.values()];
}

export type { PendingMention, TableModel };

/** Eine Zuordnung des Modells: Zahl, Posten-Key oder Tabellenlabel, Periode, Konfidenz. */
export type ModelAssignment = Readonly<{
  figureId: string;
  key: string | null;
  label: string | null;
  period: "current" | "prior" | "other";
  confidenceBp: number;
  candidateCount: number;
}>;

/**
 * Prüfungen aus der Einordnung durch das Modell. Das Modell wählt nur den Posten; der
 * Wert kommt aus den Tabellen und wird im Code verglichen. Unter der Konfidenzschwelle
 * oder bei mehreren Kandidaten wird eine Abweichung nie rot, sondern bleibt orange.
 */
export function modelAssignmentChecks(
  document: EngineDocument,
  resolver: ReturnType<typeof createResolver>,
  assignments: readonly ModelAssignment[],
  thresholdBp: number,
  /** Wer eingeordnet hat; Jev und Modell rechnen genau gleich nach. */
  source: "model" | "jev" = "model",
): CheckDraft[] {
  const figures = new Map(document.figures.map((figure) => [figure.id, figure]));
  const drafts: CheckDraft[] = [];
  for (const assignment of assignments) {
    const figure = figures.get(assignment.figureId);
    if (!figure || !assignment.key || assignment.period === "other" || figure.micro === null)
      continue;
    const posten = postenByKey.get(assignment.key) ?? {
      key: assignment.key,
      label: assignment.label ?? assignment.key.replace(/^label:/u, ""),
      kind: "balance" as const,
      row: /(?!)/u,
      text: /(?!)/u,
    };
    const draft = referenceCheck(figure, posten, assignment.period, resolver, {
      share: figure.unit === "percent",
      assignment: source,
      confidenceBp: assignment.confidenceBp,
    });
    if (!draft) continue;
    const unsure =
      draft.status === "mismatch" &&
      (assignment.confidenceBp < thresholdBp || assignment.candidateCount > 1);
    drafts.push({
      ...draft,
      status: unsure ? "uncertain" : draft.status,
      comment: unsure ? { code: "model_unsure", params: { label: posten.label } } : draft.comment,
      subjectLabel: posten.label,
      sourceKey: `${source}:${draft.sourceKey}`,
    });
  }
  return drafts;
}
