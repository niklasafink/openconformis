import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { aiRouteProviderSchema, type AiRouteProvider } from "@/domain/ai/provider";
import { appendAuditEvent } from "@/server/audit/event";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { db } from "@/server/db/client";
import { aiSavedCredentials } from "@/server/db/schema/ai";
import { configuredValue } from "@/server/environment";
import {
  activeCredentialEncryptionConfiguration,
  decryptCredentialSecret,
  encryptCredentialSecret,
  type SavedCredentialBinding,
} from "@/server/security/credential-crypto";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function savedBinding(record: {
  id: string;
  ownerUserId: string;
  provider: AiRouteProvider;
}): SavedCredentialBinding {
  return {
    kind: "saved",
    credentialId: record.id,
    ownerUserId: record.ownerUserId,
    provider: record.provider,
  };
}

/**
 * Nur `next dev`: ein OpenRouter-Schlüssel aus `DEV_OPENROUTER_API_KEY`, der gilt,
 * solange der Nutzer keinen eigenen gespeichert hat. Produktion liest ihn nie.
 */
function developmentFallbackSecret(provider: AiRouteProvider) {
  if (process.env.NODE_ENV !== "development" || provider !== "openrouter") return null;
  return configuredValue("DEV_OPENROUTER_API_KEY") || null;
}

/**
 * Speichert einen bereits beim Anbieter bestätigten Schlüssel dauerhaft für den
 * Nutzer. Ein früher gespeicherter Schlüssel desselben Anbieters wird ersetzt.
 */
export async function saveUserCredential(
  transaction: Transaction,
  input: { ownerUserId: string; provider: AiRouteProvider; secret: string },
) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`saved:${input.ownerUserId}:${input.provider}`}, 0))`,
  );
  await transaction
    .delete(aiSavedCredentials)
    .where(
      and(
        eq(aiSavedCredentials.ownerUserId, input.ownerUserId),
        eq(aiSavedCredentials.provider, input.provider),
      ),
    );

  const id = randomUUID();
  const encryption = activeCredentialEncryptionConfiguration();
  const encrypted = encryptCredentialSecret({
    secret: input.secret,
    binding: savedBinding({ id, ownerUserId: input.ownerUserId, provider: input.provider }),
    encodedKey: encryption.encodedKey,
    keyVersion: encryption.keyVersion,
  });
  await transaction.insert(aiSavedCredentials).values({
    id,
    ownerUserId: input.ownerUserId,
    provider: input.provider,
    encryptedSecret: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authenticationTag: encrypted.authenticationTag,
    encryptionKeyVersion: encrypted.keyVersion,
    secretLastFour: input.secret.slice(-4),
  });
  await appendAuditEvent(transaction, {
    actorUserId: input.ownerUserId,
    action: "ai_credential.saved",
    targetType: "ai_saved_credential",
    targetId: id,
    metadata: { provider: input.provider },
  });
}

/**
 * Entschlüsselt den gespeicherten Schlüssel. Fehlt er oder stammt er aus einer
 * nicht mehr aktiven Schlüsselversion, gilt er als nicht vorhanden.
 */
export async function readSavedCredentialSecret(input: {
  ownerUserId: string;
  provider: AiRouteProvider;
}) {
  const [record] = await db
    .select()
    .from(aiSavedCredentials)
    .where(
      and(
        eq(aiSavedCredentials.ownerUserId, input.ownerUserId),
        eq(aiSavedCredentials.provider, input.provider),
      ),
    )
    .limit(1);
  if (!record) return developmentFallbackSecret(input.provider);

  const encryption = activeCredentialEncryptionConfiguration();
  if (record.encryptionKeyVersion !== encryption.keyVersion) {
    return developmentFallbackSecret(input.provider);
  }
  try {
    return decryptCredentialSecret({
      encrypted: {
        ciphertext: record.encryptedSecret,
        nonce: record.nonce,
        authenticationTag: record.authenticationTag,
        keyVersion: record.encryptionKeyVersion,
      },
      binding: savedBinding(record),
      encodedKey: encryption.encodedKey,
    });
  } catch {
    return null;
  }
}

/** Gespeicherte Schlüssel des angemeldeten Nutzers: nur Anbieter und letzte vier Zeichen. */
export async function listSavedCredentials() {
  const user = await requireAuthenticatedSessionUser();
  const encryption = activeCredentialEncryptionConfiguration();
  const records = await db
    .select({
      provider: aiSavedCredentials.provider,
      lastFour: aiSavedCredentials.secretLastFour,
      encryptionKeyVersion: aiSavedCredentials.encryptionKeyVersion,
    })
    .from(aiSavedCredentials)
    .where(eq(aiSavedCredentials.ownerUserId, user.id));
  const saved = records
    .filter((record) => record.encryptionKeyVersion === encryption.keyVersion)
    .map(({ provider, lastFour }) => ({ provider, lastFour }));
  const fallback = developmentFallbackSecret("openrouter");
  if (fallback && !saved.some((record) => record.provider === "openrouter")) {
    saved.push({ provider: "openrouter", lastFour: fallback.slice(-4) });
  }
  return saved;
}

export async function deleteSavedCredential(rawProvider: string) {
  const user = await requireAuthenticatedSessionUser();
  const provider = aiRouteProviderSchema.parse(rawProvider);
  return db.transaction(async (transaction) => {
    const deleted = await transaction
      .delete(aiSavedCredentials)
      .where(
        and(eq(aiSavedCredentials.ownerUserId, user.id), eq(aiSavedCredentials.provider, provider)),
      )
      .returning({ id: aiSavedCredentials.id });
    for (const record of deleted) {
      await appendAuditEvent(transaction, {
        actorUserId: user.id,
        action: "ai_credential.saved_deleted",
        targetType: "ai_saved_credential",
        targetId: record.id,
        metadata: { provider },
      });
    }
    return { provider, deleted: deleted.length > 0 };
  });
}
