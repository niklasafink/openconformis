import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import postgres from "postgres";

import { createS3PrivateObjectStore } from "../src/server/storage/s3-private-object-store";
import { ingestPolicyVersion } from "../src/server/worker/ingest-policy";

if (process.env.ALLOW_INGESTION_SMOKE !== "true" || !process.env.DATABASE_URL) {
  throw new Error("Set ALLOW_INGESTION_SMOKE=true and DATABASE_URL for an isolated test database.");
}

const sql = postgres(process.env.DATABASE_URL);
const draftId = randomUUID();
const policyId = randomUUID();
const policyVersionId = randomUUID();
const intentId = randomUUID();
const objectKey = `integration-tests/${policyVersionId}.docx`;
const bytes = await readFile("assets/samples/beispiel-ikt-sicherheitsrichtlinie.docx");
const objectStore = createS3PrivateObjectStore();

try {
  const target = await objectStore.createUploadTarget({
    objectKey,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    contentLength: bytes.byteLength,
    intentId,
    expiresInSeconds: 60,
  });
  const put = await fetch(target.url, {
    method: "PUT",
    headers: target.requiredHeaders,
    body: bytes,
  });
  if (!put.ok) throw new Error(`Smoke upload failed with ${put.status}.`);

  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO anonymous_drafts (id, binding_hash, status, framework_slug, locale, expires_at)
      VALUES (${draftId}, ${"a".repeat(64)}, 'active', 'dora', 'de', now() + interval '1 day')
    `;
    await transaction`
      INSERT INTO policies (id, anonymous_draft_id, display_name)
      VALUES (${policyId}, ${draftId}, 'Worker smoke test')
    `;
    await transaction`
      INSERT INTO policy_versions (
        id, policy_id, anonymous_draft_id, version_number, source, original_filename,
        declared_mime_type, storage_driver, object_key, parse_status, uploaded_at,
        original_delete_after, parsed_delete_after
      ) VALUES (
        ${policyVersionId}, ${policyId}, ${draftId}, 1, 'upload', 'smoke.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'minio', ${objectKey}, 'uploaded', now(), now() + interval '1 day',
        now() + interval '30 days'
      )
    `;
  });

  const result = await ingestPolicyVersion({ policyVersionId });
  const [state] = await sql<
    Array<{ parse_status: string; sha256: string | null; page_count: number; blocks: number }>
  >`
    SELECT
      parse_status,
      sha256,
      page_count,
      (SELECT count(*)::int FROM document_blocks WHERE policy_version_id = ${policyVersionId}) AS blocks
    FROM policy_versions
    WHERE id = ${policyVersionId}
  `;

  process.stdout.write(`${JSON.stringify({ result, state })}\n`);
  if (state?.parse_status !== "ready" || state.blocks < 20 || !state.sha256) {
    throw new Error("Ingestion smoke validation failed.");
  }
} finally {
  await objectStore.deleteObject(objectKey).catch(() => undefined);
  await sql.end();
}
