/**
 * Abnahme des Plausichecks an den beiden Beispielberichten (gbs 2021, ICBC 2025).
 * Liest den jüngsten abgeschlossenen Lauf je Bericht aus der Datenbank und vergleicht
 * den Status der Marken mit den erwarteten Fachergebnissen aus
 * docs/OFFENLEGUNG_SESSION_PROMPT.md §2. Die Berichte selbst bleiben lokal; das Skript
 * enthält nur die Zahlen der Abnahmefälle.
 *
 *   node --import tsx scripts/disclosure-acceptance.ts            # lokale Datenbank
 *   DATABASE_URL=… node --import tsx scripts/disclosure-acceptance.ts
 */

import postgres from "postgres";

type Expected = {
  report: "gbs" | "icbc";
  /** Erkannter Text der Zahl bzw. des Richtungsworts. */
  raw: string;
  page: number;
  status: "match" | "mismatch" | "uncertain";
  rounded?: boolean;
  note: string;
};

const expectations: Expected[] = [
  {
    report: "gbs",
    raw: "Erhöhung",
    page: 19,
    status: "mismatch",
    note: "Tz 62 Erhöhung der Bilanzsumme",
  },
  {
    report: "gbs",
    raw: "-0,6",
    page: 21,
    status: "mismatch",
    note: "Tz 80 Eigenkapital -0,6 Mio.",
  },
  { report: "gbs", raw: "0,6", page: 7, status: "mismatch", note: "Tz 9 Eigenkapital 0,6 Mio." },
  {
    report: "gbs",
    raw: "5.198",
    page: 37,
    status: "match",
    rounded: true,
    note: "Fremdkapital Vorjahr 5.198",
  },
  {
    report: "gbs",
    raw: "5.197",
    page: 20,
    status: "match",
    rounded: true,
    note: "Tz 69 Vorjahr 5.197",
  },
  {
    report: "gbs",
    raw: "1.507",
    page: 36,
    status: "match",
    rounded: true,
    note: "Vorjahr Jahresüberschuss 1.507",
  },
  { report: "gbs", raw: "1.508", page: 5, status: "match", rounded: true, note: "Tz 6 TEUR 1.508" },
  {
    report: "gbs",
    raw: "- 380",
    page: 36,
    status: "match",
    rounded: true,
    note: "Steuern von -380 TEUR",
  },
  {
    report: "gbs",
    raw: "422",
    page: 37,
    status: "match",
    rounded: true,
    note: "Verbindlichkeiten auf 422 TEUR",
  },
  {
    report: "gbs",
    raw: "15",
    page: 37,
    status: "match",
    rounded: true,
    note: "Verbindlichkeiten um 15 TEUR",
  },
  { report: "gbs", raw: "108.686,00", page: 24, status: "match", note: "Anlagevermögen insgesamt" },
  { report: "gbs", raw: "6.828.230,37", page: 24, status: "match", note: "Summe der Aktiva" },
  {
    report: "gbs",
    raw: "6.828.230,37",
    page: 25,
    status: "match",
    note: "Summe der Passiva = Aktiva",
  },
  { report: "gbs", raw: "736", page: 5, status: "match", note: "Tz 6 Personalaufwand um TEUR 736" },
  {
    report: "gbs",
    raw: "70",
    page: 38,
    status: "match",
    rounded: true,
    note: "Rückstellungen mit 70 %",
  },
  {
    report: "gbs",
    raw: "-3.922,3",
    page: 48,
    status: "uncertain",
    note: "Anlage 2.2 Betriebsergebnis",
  },
  {
    report: "gbs",
    raw: "72",
    page: 38,
    status: "uncertain",
    note: "Anlagevermögen um 72 (Vorjahr 181)",
  },
  {
    report: "icbc",
    raw: "774.491,78",
    page: 15,
    status: "mismatch",
    note: "Sonstige Vermögensgegenstände",
  },
  {
    report: "icbc",
    raw: "33.541.992,56",
    page: 30,
    status: "mismatch",
    note: "Regionale Zinserträge Gesamt",
  },
  {
    report: "icbc",
    raw: "314.919,99",
    page: 30,
    status: "mismatch",
    note: "Provisionsaufwendungen Gesamt",
  },
  { report: "icbc", raw: "11.321.501,02", page: 30, status: "match", note: "Nettozinsertrag" },
  {
    report: "icbc",
    raw: "467.223,67",
    page: 31,
    status: "match",
    note: "Personalaufwand um EUR 467.223,67",
  },
  { report: "icbc", raw: "2.598,9", page: 37, status: "match", note: "Provisionsergebnis 2.598,9" },
  {
    report: "icbc",
    raw: "1.001,8",
    page: 37,
    status: "match",
    note: "Provisionsergebnis Vorjahr 1.001,8",
  },
  {
    report: "icbc",
    raw: "1.795.596.57",
    page: 31,
    status: "match",
    note: "Sachaufwand 1.795.596.57",
  },
  {
    report: "icbc",
    raw: "2,1",
    page: 37,
    status: "uncertain",
    note: "Verwaltungsaufwand 2,1 Mio.",
  },
];

const sql = postgres(
  process.env.DATABASE_URL ?? "postgresql://conformis:conformis@127.0.0.1:5432/conformis",
  { max: 1 },
);

const rank = { match: 0, uncertain: 1, mismatch: 2 } as const;

async function latestRun(report: Expected["report"]) {
  const pattern = report === "gbs" ? "%117-gbs%" : "%icbc%";
  const [run] = await sql<{ id: string; case_document_id: string }[]>`
    select r.id, r.report_case_document_id as case_document_id
    from disclosure_runs r
    join disclosure_case_documents d on d.id = r.report_case_document_id
    where d.display_name ilike ${pattern} and r.status in ('completed', 'completed_with_gaps')
    order by r.completed_at desc limit 1`;
  return run;
}

async function subjects(runId: string, caseDocumentId: string) {
  return sql<
    {
      raw: string;
      page: number | null;
      status: keyof typeof rank;
      rounded: boolean;
      silent: boolean;
    }[]
  >`
    select coalesce(f.raw_text, s.raw_text) as raw, x.page_number as page, k.status, k.rounded,
      (k.status = 'uncertain' and (k.kind in ('table_sum', 'horizontal_sum') or k.comment_code = 'direction_unclear')) as silent
    from disclosure_checks k
    left join disclosure_figures f on f.id = k.subject_figure_id
    left join disclosure_statements s on s.id = k.statement_id
    join disclosure_block_context x
      on x.document_block_id = coalesce(f.document_block_id, s.document_block_id)
     and x.case_document_id = ${caseDocumentId}
    where k.run_id = ${runId}`;
}

let failures = 0;
for (const report of ["gbs", "icbc"] as const) {
  const run = await latestRun(report);
  if (!run) {
    console.log(`${report}: kein abgeschlossener Lauf gefunden`);
    failures += expectations.filter((entry) => entry.report === report).length;
    continue;
  }
  const rows = await subjects(run.id, run.case_document_id);
  for (const expected of expectations.filter((entry) => entry.report === report)) {
    const matching = rows.filter(
      (row) => row.raw === expected.raw && row.page === expected.page && !row.silent,
    );
    const worst = matching.reduce<(typeof matching)[number] | null>(
      (current, row) => (!current || rank[row.status] > rank[current.status] ? row : current),
      null,
    );
    const statusOk = worst?.status === expected.status;
    const roundedOk =
      expected.rounded === undefined || matching.some((row) => row.rounded === expected.rounded);
    const ok = statusOk && roundedOk;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${report.padEnd(4)} S. ${String(expected.page).padEnd(3)} ${expected.raw.padEnd(14)} ${
        worst?.status ?? "keine Prüfung"
      }${worst && expected.rounded ? (roundedOk ? ", gerundet" : ", nicht gerundet") : ""}  — ${expected.note}`,
    );
  }
}
await sql.end();
console.log(
  failures === 0 ? "\nAlle Abnahmefälle stimmen." : `\n${failures} Abnahmefälle weichen ab.`,
);
process.exit(failures === 0 ? 0 : 1);
