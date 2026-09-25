import { randomUUID } from "node:crypto";

import postgres from "postgres";

/**
 * Bringt eine im Browser angelegte Prüfung der Offenlegungspflicht in einen fertigen
 * Zustand — direkt in der Datenbank, ohne Modell- oder TypeSafe-Aufruf. Die echte
 * Ausführung hat ihre eigenen Unit- und DB-Tests; die Browserprüfung braucht nur Läufe
 * mit Ergebnissen und exakten Belegen.
 */

function connect() {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://conformis:conformis@127.0.0.1:5432/conformis_e2e";
  return postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
}

const demoTemplateKey = "hgb-anhang-lagebericht-kapg-demo";

type Report = {
  case_document_id: string;
  policy_version_id: string;
  organization_id: string;
  owner_user_id: string;
  sha256: string;
  parser_version: string;
};

async function reportOf(sql: postgres.Sql, caseId: string) {
  const [report] = await sql<Report[]>`
    select d.id as case_document_id, v.id as policy_version_id, c.organization_id,
      c.owner_user_id, v.sha256, v.parser_version
    from disclosure_cases c
    join disclosure_case_documents d on d.case_id = c.id and d.role = 'report'
    join policy_versions v on v.id = d.policy_version_id
    where c.id = ${caseId} and v.parse_status = 'ready'`;
  if (!report) throw new Error("DISCLOSURE_REPORT_NOT_READY");
  return report;
}

/** Die veröffentlichte Demo-Vorlage; der Seed `pnpm disclosure:seed-checklist` legt sie an. */
export async function demoTemplateRelease() {
  const sql = connect();
  try {
    const [release] = await sql<{ id: string }[]>`
      select r.id from disclosure_checklist_template_releases r
      join disclosure_checklist_templates t on t.id = r.template_id
      where t.key = ${demoTemplateKey} and r.status = 'published'
      order by r.version desc limit 1`;
    if (!release) throw new Error("DEMO_TEMPLATE_MISSING");
    return release.id;
  } finally {
    await sql.end();
  }
}

/**
 * Ein beendeter Lauf der Vollständigkeitsprüfung auf der Demo-Vorlage: Positionen mit
 * einer Fundstelle bekommen „erfüllt“ mit einem exakten Zitat aus dem Block, die übrigen
 * „Keine Einschätzung möglich“ ohne Beleg. Gibt die Lauf-ID zurück.
 */
export async function seedFinishedCompletenessRun(caseId: string) {
  const sql = connect();
  try {
    const report = await reportOf(sql, caseId);
    const [release] = await sql<{ id: string }[]>`
      select r.id from disclosure_checklist_template_releases r
      join disclosure_checklist_templates t on t.id = r.template_id
      where t.key = ${demoTemplateKey} and r.status = 'published'
      order by r.version desc limit 1`;
    if (!release) throw new Error("DEMO_TEMPLATE_MISSING");
    const items = await sql<
      {
        id: string;
        external_key: string;
        reference: string;
        title: string;
        requirement: string;
        aspects: string[];
        parent_key: string | null;
        content_hash: string;
      }[]
    >`select i.id, i.external_key, i.reference, i.title, i.requirement, i.aspects,
        p.external_key as parent_key, i.content_hash
      from disclosure_checklist_template_items i
      left join disclosure_checklist_template_items p on p.id = i.parent_item_id
      where i.release_id = ${release.id} order by i.display_order`;
    const blocks = await sql<
      { id: string; canonical_text: string; text_hash: string; page_number: number | null }[]
    >`select id, canonical_text, text_hash, page_number from document_blocks
      where policy_version_id = ${report.policy_version_id}
        and length(canonical_text) >= 40 order by ordinal`;

    const runId = randomUUID();
    await sql`
      insert into disclosure_runs (
        id, case_id, organization_id, owner_user_id, kind, status, stage,
        report_case_document_id, report_policy_version_id, report_sha256,
        report_parser_version, extraction_version, check_version, configuration_hash,
        route_provider, provider_model_id, model_profile_id, model_catalogue_version,
        prompt_version, checklist_template_release_id, checklist_hash, planned_check_count,
        started_at, completed_at
      ) values (
        ${runId}, ${caseId}, ${report.organization_id}, ${report.owner_user_id},
        'completeness', 'completed', 'done', ${report.case_document_id},
        ${report.policy_version_id}, ${report.sha256}, ${report.parser_version}, 'e2e',
        'disclosure-completeness-v1', ${`e2e-${runId}`}, 'openrouter', 'e2e/model',
        'openrouter:e2e/model', 'e2e', 'disclosure-completeness-v1', ${release.id},
        'e2e-checklist', ${items.length}, now(), now()
      )`;
    const used = new Set<string>();
    for (const [index, item] of items.entries()) {
      const [runItem] = await sql<{ id: string }[]>`
        insert into disclosure_run_checklist_items (
          run_id, ordinal, external_key, reference, title, requirement, aspects,
          parent_key, depth, content_hash, template_release_id, source_item_id
        ) values (
          ${runId}, ${index + 1}, ${item.external_key}, ${item.reference}, ${item.title},
          ${item.requirement}, ${item.aspects}, ${item.parent_key},
          ${item.parent_key ? 1 : 0}, ${item.content_hash}, ${release.id}, ${item.id}
        ) returning id`;
      // Ein Block, dessen Text ein Wort des Titels trägt, und der noch kein Zitat hat.
      const words = item.title
        .split(/[^\p{L}]+/u)
        .filter((word) => word.length >= 6)
        .map((word) => word.toLowerCase());
      const block = blocks.find(
        (candidate) =>
          !used.has(candidate.id) &&
          words.some((word) => candidate.canonical_text.toLowerCase().includes(word)),
      );
      const status = block ? (index % 3 === 1 ? "partially_fulfilled" : "fulfilled") : null;
      const [result] = await sql<{ id: string }[]>`
        insert into disclosure_completeness_results (
          run_id, run_item_id, status, explanation, missing_information,
          confidence_basis_points, model_id, prompt_version, input_hash
        ) values (
          ${runId}, ${runItem!.id}, ${status ?? "no_assessment_possible"},
          ${
            block
              ? "- Der Bericht enthält die Angabe an der zitierten Stelle."
              : "- Im Bericht wurde keine Stelle zu dieser Angabepflicht gefunden."
          },
          ${status === "fulfilled" ? [] : ["Angabe im Bericht"]},
          ${block ? 8500 : 0}, ${block ? "e2e/model" : null}, 'disclosure-completeness-v1',
          ${`e2e-${index}`}
        ) returning id`;
      if (block) {
        used.add(block.id);
        const quote = block.canonical_text
          .slice(0, 90)
          .replace(/\s+\S*$/u, "")
          .trim();
        await sql`
          insert into disclosure_completeness_evidence (
            result_id, citation_order, document_block_id, support, exact_quote,
            block_text_hash, page_number
          ) values (
            ${result!.id}, 1, ${block.id}, 'supports', ${quote}, ${block.text_hash},
            ${block.page_number}
          )`;
      }
    }
    return runId;
  } finally {
    await sql.end();
  }
}
