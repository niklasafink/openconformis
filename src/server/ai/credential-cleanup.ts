import "server-only";

import { and, eq, inArray, lt } from "drizzle-orm";

import type { AiCredentialPurpose } from "@/domain/ai/provider";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { aiCredentials } from "@/server/db/schema/ai";

export async function deleteTemporaryCredentialsForBinding(input: {
  purpose: AiCredentialPurpose;
  bindingId: string;
  ownerUserId?: string;
}) {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const filters = [
      eq(aiCredentials.purpose, input.purpose),
      eq(aiCredentials.bindingId, input.bindingId),
      inArray(aiCredentials.status, ["active", "expired"]),
    ];
    if (input.ownerUserId) filters.push(eq(aiCredentials.ownerUserId, input.ownerUserId));

    const deleted = await transaction
      .update(aiCredentials)
      .set({
        status: "deleted",
        encryptedSecret: null,
        nonce: null,
        authenticationTag: null,
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(...filters))
      .returning({
        id: aiCredentials.id,
        ownerUserId: aiCredentials.ownerUserId,
        provider: aiCredentials.provider,
        purpose: aiCredentials.purpose,
      });

    for (const credential of deleted) {
      await appendAuditEvent(transaction, {
        actorUserId: credential.ownerUserId,
        action: "ai_credential.deleted",
        targetType: "ai_credential",
        targetId: credential.id,
        metadata: { provider: credential.provider, purpose: credential.purpose },
      });
    }
    return deleted.length;
  });
}

export async function expireTemporaryCredentials() {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const expired = await transaction
      .update(aiCredentials)
      .set({
        status: "expired",
        encryptedSecret: null,
        nonce: null,
        authenticationTag: null,
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(aiCredentials.status, "active"), lt(aiCredentials.expiresAt, now)))
      .returning({
        id: aiCredentials.id,
        ownerUserId: aiCredentials.ownerUserId,
        provider: aiCredentials.provider,
        purpose: aiCredentials.purpose,
      });

    for (const credential of expired) {
      await appendAuditEvent(transaction, {
        actorUserId: credential.ownerUserId,
        action: "ai_credential.expired",
        targetType: "ai_credential",
        targetId: credential.id,
        metadata: { provider: credential.provider, purpose: credential.purpose },
      });
    }
    return expired.length;
  });
}
