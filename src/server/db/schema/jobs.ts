import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workerHeartbeats = pgTable(
  "worker_heartbeats",
  {
    workerId: text("worker_id").primaryKey(),
    buildId: text("build_id").notNull(),
    healthy: boolean("healthy").default(true).notNull(),
    safeStatus: text("safe_status").default("running").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("worker_heartbeats_last_seen_idx").on(table.lastSeenAt)],
);

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bucket: text("bucket").notNull(),
    subjectHash: text("subject_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").default(1).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("rate_limit_windows_subject_uidx").on(
      table.bucket,
      table.subjectHash,
      table.windowStartedAt,
    ),
    index("rate_limit_windows_expiry_idx").on(table.expiresAt),
  ],
);

export const jobOutboxStatus = pgEnum("job_outbox_status", [
  "pending",
  "publishing",
  "published",
  "dead",
]);

export type JobOutboxPayload =
  | { kind: "document_ingestion"; policyVersionId: string }
  | { kind: "document_ocr"; policyVersionId: string }
  | { kind: "analysis_execution"; analysisId: string };

export const jobOutbox = pgTable(
  "job_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    queueName: text("queue_name").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    payload: jsonb("payload").$type<JobOutboxPayload>().notNull(),
    status: jobOutboxStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    uniqueIndex("job_outbox_deduplication_key_uidx").on(table.deduplicationKey),
    index("job_outbox_dispatch_idx").on(table.status, table.availableAt, table.createdAt),
  ],
);
