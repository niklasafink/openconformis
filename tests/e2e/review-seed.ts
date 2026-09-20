import { randomUUID } from "node:crypto";

import postgres from "postgres";

/**
 * Bringt eine im Browser angelegte Prüfung in einen fertigen Zustand — direkt in
 * der isolierten Testdatenbank, ohne einen einzigen Modell- oder TypeSafe-Aufruf.
 * Die echte Ausführung (Workflow, Jev, Eskalation) hat ihre eigenen Prüfungen;
 * die Browserprüfung braucht nur ein Raster mit Antworten und exakten Belegen.
 */
export async function seedFinishedReviewRun(reviewTableId: string) {
  const databaseUrl =
    process.env.DATABASE_URL ?? "postgresql://conformis:conformis@127.0.0.1:5432/conformis_e2e";
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    const [table] = await sql<{ organization_id: string; owner_user_id: string }[]>`
      select organization_id, owner_user_id from review_tables where id = ${reviewTableId}`;
    if (!table) throw new Error("REVIEW_TABLE_NOT_FOUND");
    const documents = await sql<
      { id: string; policy_version_id: string; ordinal: number; display_name: string }[]
    >`select id, policy_version_id, ordinal, display_name
        from review_documents where review_table_id = ${reviewTableId} order by ordinal`;
    const columns = await sql<
      {
        id: string;
        ordinal: number;
        label: string;
        column_type: "noul" | "choice" | "score";
        instructions: string;
        criteria: Record<string, unknown>;
        content_hash: string;
      }[]
    >`select id, ordinal, label, column_type, instructions, criteria, content_hash
        from review_columns
        where review_table_id = ${reviewTableId} and archived_at is null order by ordinal`;
    if (documents.length === 0 || columns.length === 0) throw new Error("REVIEW_EMPTY");

    const runId = randomUUID();
    const totalCells = documents.length * columns.length;
    await sql`
      insert into review_runs (
        id, review_table_id, organization_id, owner_user_id, status, stage, progress_percent,
        completed_cell_count, total_cell_count, escalated_cell_count, failed_cell_count,
        decision_engine, document_set_hash, column_set_hash, configuration_hash,
        routing_provider, jev_model_id, escalation_provider, provider_model_id,
        model_profile_id, model_catalogue_version, privacy_profile_id, prompt_version,
        escalation_threshold_bp, citation_accept_threshold_bp, escalation_budget_cells,
        state_token_budget, started_at, completed_at
      ) values (
        ${runId}, ${reviewTableId}, ${table.organization_id}, ${table.owner_user_id},
        'completed', 'finalizing', 100, ${totalCells}, ${totalCells}, 0, 0,
        'jev', 'e2e-documents', 'e2e-columns', 'e2e-configuration',
        'typesafe', 'jev-latest', 'openrouter', 'e2e/model', 'e2e-model', 'e2e',
        'e2e-privacy', 'e2e', 7500, 8000, 10, 32000, now(), now()
      )`;

    const runColumnIds = new Map<string, string>();
    for (const column of columns) {
      const [runColumn] = await sql<{ id: string }[]>`
        insert into review_run_columns (
          review_run_id, review_column_id, ordinal, label, column_type, instructions,
          criteria, content_hash
        ) values (
          ${runId}, ${column.id}, ${column.ordinal}, ${column.label}, ${column.column_type},
          ${column.instructions}, ${sql.json(column.criteria as never)}, ${column.content_hash}
        ) returning id`;
      runColumnIds.set(column.id, runColumn!.id);
    }

    const evidenceQuotes: string[] = [];
    for (const document of documents) {
      const [runDocument] = await sql<{ id: string }[]>`
        insert into review_run_documents (
          review_run_id, review_document_id, policy_version_id, ordinal, display_name,
          started_at, finished_at
        ) values (
          ${runId}, ${document.id}, ${document.policy_version_id}, ${document.ordinal},
          ${document.display_name}, now(), now()
        ) returning id`;
      const [block] = await sql<
        {
          id: string;
          canonical_text: string;
          text_hash: string;
          page_number: number | null;
          paragraph_number: number | null;
        }[]
      >`select id, canonical_text, text_hash, page_number, paragraph_number
          from document_blocks
          where policy_version_id = ${document.policy_version_id}
            and block_type = 'paragraph' and length(canonical_text) > 80
          order by ordinal limit 1`;
      if (!block) throw new Error("DOCUMENT_BLOCKS_MISSING");
      // Ein exakter Substring eines unveränderlichen Blocks — sonst wäre es kein Beleg.
      const quote = block.canonical_text.slice(0, 72).trim();
      evidenceQuotes.push(quote);

      for (const column of columns) {
        const runColumnId = runColumnIds.get(column.id)!;
        const criteria = column.criteria as
          | { type: "noul"; true: { label: string } }
          | { type: "choice"; options: Array<{ key: string; label: string }> }
          | { type: "score"; levels: Array<{ label: string }> };
        const answer =
          criteria.type === "noul"
            ? { boolean: true, choice: null, score: null, label: criteria.true.label }
            : criteria.type === "choice"
              ? {
                  boolean: null,
                  choice: criteria.options[0]!.key,
                  score: null,
                  label: criteria.options[0]!.label,
                }
              : { boolean: null, choice: null, score: 5_000, label: criteria.levels[1]!.label };
        const distribution =
          criteria.type === "noul"
            ? { true: 0.915, false: 0.085 }
            : criteria.type === "choice"
              ? Object.fromEntries(
                  criteria.options.map((option, index) => [
                    option.key,
                    index === 0 ? 0.915 : 0.085,
                  ]),
                )
              : { "1": 0.915, "0": 0.085 };
        const rationale = `${column.label}: ${answer.label} Wahrscheinlichkeit 91,5 %. Beleg [1].`;
        const [cell] = await sql<{ id: string }[]>`
          insert into review_cells (
            review_run_id, run_document_id, run_column_id, state, source,
            answer_boolean, answer_choice, answer_score_bp, probability_bp, confidence_bp,
            distribution, rationale, citation_verdict, decision_model_id
          ) values (
            ${runId}, ${runDocument!.id}, ${runColumnId}, 'complete', 'jev',
            ${answer.boolean}, ${answer.choice}, ${answer.score}, 9150, 8300,
            ${sql.json(distribution)}, ${rationale}, 'verified', 'jev-latest'
          ) returning id`;
        await sql`
          insert into review_cell_evidence (
            cell_id, document_block_id, citation_order, support, exact_quote, block_text_hash,
            page_number, paragraph_number
          ) values (
            ${cell!.id}, ${block.id}, 1, 'supports', ${quote}, ${block.text_hash},
            ${block.page_number}, ${block.paragraph_number}
          )`;
      }
    }
    return { runId, evidenceQuotes };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
