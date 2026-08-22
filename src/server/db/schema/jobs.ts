import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
