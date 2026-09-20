import "server-only";

import { and, eq, inArray, lt } from "drizzle-orm";

import type { AiCredentialPurpose } from "@/domain/ai/provider";
import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { aiCredentials } from "@/server/db/schema/ai";

/** Löscht einen einzelnen Schlüssel, etwa wenn der Lauf, für den er gedacht war, nicht entsteht. */
export async function deleteTemporaryCredential(input: {
  credentialId: string;
  ownerUserId: string;
}) {
  const now = new Date();
  await db
    .update(aiCredentials)
    .set({
      status: "deleted",
      encryptedSecret: null,
      nonce: null,
      authenticationTag: null,
      deletedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(aiCredentials.id, input.credentialId),
        eq(aiCredentials.ownerUserId, input.ownerUserId),
        inArray(aiCredentials.status, ["active", "expired"]),
      ),
    );
}

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

/**
 * Räumt den optionalen Jev-Schlüssel einer Analyse ab. Er hängt am selben Draft wie
 * der Analyse-Schlüssel, hat aber einen eigenen Zweck. Aufrufer rufen dies nur, wenn
 * die Analyse einen Jev-Schlüssel eingefroren hat — ohne ihn bleibt der Abschluss
 * unverändert.
 */
export function deleteAnalysisAssistCredential(input: { draftId: string; ownerUserId: string }) {
  return deleteTemporaryCredentialsForBinding({
    purpose: "analysis_assist",
    bindingId: input.draftId,
    ownerUserId: input.ownerUserId,
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
