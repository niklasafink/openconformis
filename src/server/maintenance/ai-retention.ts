import "server-only";

import { lt } from "drizzle-orm";

import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { analysisAssessmentCache } from "@/server/db/schema/analyses";
import { chatThreads } from "@/server/db/schema/chat";

export async function purgeExpiredAiData() {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const expiredThreads = await transaction
      .delete(chatThreads)
      .where(lt(chatThreads.deleteAfter, now))
      .returning({
        id: chatThreads.id,
        organizationId: chatThreads.organizationId,
        ownerUserId: chatThreads.ownerUserId,
      });
    for (const thread of expiredThreads) {
      await appendAuditEvent(transaction, {
        organizationId: thread.organizationId,
        actorUserId: thread.ownerUserId,
        action: "chat.thread_expired",
        targetType: "chat_thread",
        targetId: thread.id,
      });
    }
    const expiredCacheEntries = await transaction
      .delete(analysisAssessmentCache)
      .where(lt(analysisAssessmentCache.expiresAt, now))
      .returning({ id: analysisAssessmentCache.id });
    return {
      expiredThreads: expiredThreads.length,
      expiredCacheEntries: expiredCacheEntries.length,
    };
  });
}
