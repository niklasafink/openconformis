import "server-only";

import type { JobOutboxPayload } from "@/server/db/schema/jobs";
import { postgresClient } from "@/server/db/client";

import { getJobBoss } from "./boss";

type ClaimedOutboxJob = {
  id: string;
  queue_name: string;
  deduplication_key: string;
  payload: JobOutboxPayload;
  attempts: number;
};

function safeErrorCode(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return name.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80);
}

async function claimOutboxBatch(limit: number) {
  return postgresClient<ClaimedOutboxJob[]>`
    WITH candidates AS (
      SELECT id
      FROM job_outbox
      WHERE (
        status = 'pending' AND available_at <= now()
      ) OR (
        status = 'publishing' AND locked_at < now() - interval '10 minutes'
      )
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE job_outbox AS jobs
    SET status = 'publishing', locked_at = now(), attempts = attempts + 1
    FROM candidates
    WHERE jobs.id = candidates.id
    RETURNING jobs.id, jobs.queue_name, jobs.deduplication_key, jobs.payload, jobs.attempts
  `;
}

export async function dispatchOutboxBatch(limit = 10) {
  const jobs = await claimOutboxBatch(Math.max(1, Math.min(limit, 50)));
  if (jobs.length === 0) return 0;

  const boss = await getJobBoss();

  for (const job of jobs) {
    try {
      await boss.send(job.queue_name, job.payload, {
        singletonKey: job.deduplication_key,
        singletonSeconds: 24 * 60 * 60,
      });
      await postgresClient`
        UPDATE job_outbox
        SET status = 'published', published_at = now(), locked_at = NULL, last_error_code = NULL
        WHERE id = ${job.id} AND status = 'publishing'
      `;
    } catch (error) {
      const dead = job.attempts >= 10;
      const delaySeconds = Math.min(300, 2 ** Math.min(job.attempts, 8));
      await postgresClient`
        UPDATE job_outbox
        SET
          status = ${dead ? "dead" : "pending"}::job_outbox_status,
          locked_at = NULL,
          available_at = now() + (${delaySeconds} * interval '1 second'),
          last_error_code = ${safeErrorCode(error)}
        WHERE id = ${job.id} AND status = 'publishing'
      `;
    }
  }

  return jobs.length;
}
