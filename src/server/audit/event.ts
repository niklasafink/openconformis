import "server-only";

import type { db } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema/application";

import { createAuditMetadata, type AuditMetadata } from "./metadata";

type AuditWriter = Pick<typeof db, "insert">;

export type AuditEventInput = {
  organizationId?: string;
  actorUserId?: string;
  anonymousDraftId?: string;
  action: string;
  targetType: string;
  targetId: string;
  requestId?: string;
  metadata?: AuditMetadata;
};

export async function appendAuditEvent(writer: AuditWriter, event: AuditEventInput) {
  await writer.insert(auditEvents).values({
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    anonymousDraftId: event.anonymousDraftId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    requestId: event.requestId,
    metadata: createAuditMetadata(event.metadata),
  });
}
