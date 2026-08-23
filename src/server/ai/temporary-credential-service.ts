import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

import {
  aiCredentialPurposeSchema,
  aiRouteProviderSchema,
  type AiCredentialPurpose,
  type AiRouteProvider,
} from "@/domain/ai/provider";
import { createContentHash } from "@/domain/frameworks/content-hash";
import { appendAuditEvent } from "@/server/audit/event";
import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { db } from "@/server/db/client";
import { aiCredentials } from "@/server/db/schema/ai";
import { getBoundActiveDraft } from "@/server/drafts/framework-selection";
import {
  activeCredentialEncryptionConfiguration,
  decryptCredentialSecret,
  encryptCredentialSecret,
  type CredentialBinding,
} from "@/server/security/credential-crypto";

import { validateProviderCredential } from "./credential-validation";
import { isStrictAnalysisProviderAvailable } from "./provider-routing";

export class TemporaryCredentialError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TemporaryCredentialError";
  }
}

function configuredProviders() {
  return new Set(
    (process.env.BYOK_PROVIDER_ALLOWLIST ?? "")
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
  );
}

function credentialTtlHours() {
  const hours = Number.parseInt(process.env.BYOK_CREDENTIAL_TTL_HOURS?.trim() || "24", 10);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) {
    throw new TemporaryCredentialError("BYOK_TTL_INVALID");
  }
  return hours;
}

function bindingFromRecord(record: {
  id: string;
  ownerUserId: string;
  sessionId: string;
  provider: AiRouteProvider;
  purpose: AiCredentialPurpose;
  bindingId: string;
  expiresAt: Date;
}): CredentialBinding {
  return {
    credentialId: record.id,
    ownerUserId: record.ownerUserId,
    sessionId: record.sessionId,
    provider: record.provider,
    purpose: record.purpose,
    bindingId: record.bindingId,
    expiresAt: record.expiresAt.toISOString(),
  };
}

export async function createTemporaryCredential(input: {
  provider: string;
  purpose: string;
  bindingId: string;
  requiredModelId: string;
  secret: string;
  privacyAttestationAccepted?: boolean;
}) {
  const user = await requireAuthenticatedSessionUser();
  const provider = aiRouteProviderSchema.parse(input.provider);
  const purpose = aiCredentialPurposeSchema.parse(input.purpose);
  if (
    input.secret.length < 8 ||
    input.secret.length > 20_000 ||
    !input.requiredModelId.trim() ||
    input.requiredModelId.length > 300
  ) {
    throw new TemporaryCredentialError("BYOK_INPUT_INVALID");
  }
  if (!configuredProviders().has(provider)) {
    throw new TemporaryCredentialError("BYOK_PROVIDER_DISABLED");
  }
  if (purpose === "analysis" && !isStrictAnalysisProviderAvailable(provider)) {
    throw new TemporaryCredentialError("BYOK_PRIVACY_ROUTE_UNAVAILABLE");
  }
  if (
    purpose === "analysis" &&
    (provider === "requesty" || provider === "openai") &&
    !input.privacyAttestationAccepted
  ) {
    throw new TemporaryCredentialError("BYOK_PRIVACY_ATTESTATION_REQUIRED");
  }

  let bindingId = user.sessionId;
  if (purpose === "analysis") {
    const boundDraft = await getBoundActiveDraft(input.bindingId);
    if (!boundDraft || boundDraft.id !== input.bindingId) {
      throw new TemporaryCredentialError("BYOK_BINDING_NOT_FOUND");
    }
    bindingId = boundDraft.id;
  }

  const validation = await validateProviderCredential({
    provider,
    secret: input.secret,
    requiredModelId: input.requiredModelId,
  });
  const credentialId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + credentialTtlHours() * 60 * 60 * 1_000);
  const binding = bindingFromRecord({
    id: credentialId,
    ownerUserId: user.id,
    sessionId: user.sessionId,
    provider,
    purpose,
    bindingId,
    expiresAt,
  });
  const encryption = activeCredentialEncryptionConfiguration();
  const encrypted = encryptCredentialSecret({
    secret: input.secret,
    binding,
    encodedKey: encryption.encodedKey,
    keyVersion: encryption.keyVersion,
  });
  const safeLabel = validation.safeLabel?.trim().slice(0, 200) || undefined;

  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${user.id}:${user.sessionId}:${provider}:${purpose}:${bindingId}`}, 0))`,
    );
    const replaced = await transaction
      .update(aiCredentials)
      .set({
        status: "revoked",
        encryptedSecret: null,
        nonce: null,
        authenticationTag: null,
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiCredentials.ownerUserId, user.id),
          eq(aiCredentials.sessionId, user.sessionId),
          eq(aiCredentials.provider, provider),
          eq(aiCredentials.purpose, purpose),
          eq(aiCredentials.bindingId, bindingId),
          eq(aiCredentials.status, "active"),
        ),
      )
      .returning({ id: aiCredentials.id });

    for (const priorCredential of replaced) {
      await appendAuditEvent(transaction, {
        actorUserId: user.id,
        action: "ai_credential.replaced",
        targetType: "ai_credential",
        targetId: priorCredential.id,
        metadata: { provider, purpose },
      });
    }

    await transaction.insert(aiCredentials).values({
      id: credentialId,
      ownerUserId: user.id,
      sessionId: user.sessionId,
      provider,
      purpose,
      bindingId,
      encryptedSecret: encrypted.ciphertext,
      nonce: encrypted.nonce,
      authenticationTag: encrypted.authenticationTag,
      encryptionKeyVersion: encrypted.keyVersion,
      secretLastFour: input.secret.slice(-4),
      safeLabel,
      privacyAttestationAccepted: Boolean(input.privacyAttestationAccepted),
      accessibleModelIds: validation.accessibleModelIds,
      modelAccessHash: createContentHash(validation.accessibleModelIds),
      validatedAt: now,
      expiresAt,
    });
    await appendAuditEvent(transaction, {
      actorUserId: user.id,
      action: "ai_credential.connected",
      targetType: "ai_credential",
      targetId: credentialId,
      metadata: {
        provider,
        purpose,
        expiresAt: expiresAt.toISOString(),
        privacyAttestationAccepted: Boolean(input.privacyAttestationAccepted),
      },
    });
  });

  return {
    credentialId,
    provider,
    purpose,
    lastFour: input.secret.slice(-4),
    safeLabel,
    accessibleModelIds: validation.accessibleModelIds,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function revokeTemporaryCredential(credentialId: string) {
  const user = await requireAuthenticatedSessionUser();
  const now = new Date();
  return db.transaction(async (transaction) => {
    const [revoked] = await transaction
      .update(aiCredentials)
      .set({
        status: "revoked",
        encryptedSecret: null,
        nonce: null,
        authenticationTag: null,
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiCredentials.id, credentialId),
          eq(aiCredentials.ownerUserId, user.id),
          eq(aiCredentials.sessionId, user.sessionId),
          eq(aiCredentials.status, "active"),
        ),
      )
      .returning({
        id: aiCredentials.id,
        provider: aiCredentials.provider,
        purpose: aiCredentials.purpose,
      });
    if (!revoked) throw new TemporaryCredentialError("BYOK_CREDENTIAL_NOT_FOUND");

    await appendAuditEvent(transaction, {
      actorUserId: user.id,
      action: "ai_credential.revoked",
      targetType: "ai_credential",
      targetId: revoked.id,
      metadata: { provider: revoked.provider, purpose: revoked.purpose },
    });
    return { credentialId: revoked.id, status: "revoked" as const };
  });
}

export async function listActiveTemporaryCredentials(purpose: AiCredentialPurpose) {
  const user = await requireAuthenticatedSessionUser();
  return db
    .select({
      credentialId: aiCredentials.id,
      provider: aiCredentials.provider,
      purpose: aiCredentials.purpose,
      lastFour: aiCredentials.secretLastFour,
      safeLabel: aiCredentials.safeLabel,
      accessibleModelIds: aiCredentials.accessibleModelIds,
      expiresAt: aiCredentials.expiresAt,
    })
    .from(aiCredentials)
    .where(
      and(
        eq(aiCredentials.ownerUserId, user.id),
        eq(aiCredentials.sessionId, user.sessionId),
        eq(aiCredentials.purpose, purpose),
        eq(aiCredentials.status, "active"),
        gt(aiCredentials.expiresAt, new Date()),
      ),
    );
}

export async function withTemporaryCredential<T>(
  input: {
    credentialId: string;
    ownerUserId: string;
    provider: AiRouteProvider;
    purpose: AiCredentialPurpose;
    bindingId: string;
    requiredModelId: string;
  },
  runWithSecret: (secret: string) => Promise<T>,
) {
  const [credential] = await db
    .select()
    .from(aiCredentials)
    .where(
      and(
        eq(aiCredentials.id, input.credentialId),
        eq(aiCredentials.ownerUserId, input.ownerUserId),
        eq(aiCredentials.provider, input.provider),
        eq(aiCredentials.purpose, input.purpose),
        eq(aiCredentials.bindingId, input.bindingId),
        eq(aiCredentials.status, "active"),
        gt(aiCredentials.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (
    !credential?.encryptedSecret ||
    !credential.nonce ||
    !credential.authenticationTag ||
    !credential.accessibleModelIds.includes(input.requiredModelId)
  ) {
    throw new TemporaryCredentialError("BYOK_CREDENTIAL_NOT_FOUND");
  }
  const encryption = activeCredentialEncryptionConfiguration();
  if (encryption.keyVersion !== credential.encryptionKeyVersion) {
    throw new TemporaryCredentialError("BYOK_KEY_VERSION_UNAVAILABLE");
  }
  const secret = decryptCredentialSecret({
    encrypted: {
      ciphertext: credential.encryptedSecret,
      nonce: credential.nonce,
      authenticationTag: credential.authenticationTag,
      keyVersion: credential.encryptionKeyVersion,
    },
    binding: bindingFromRecord(credential),
    encodedKey: encryption.encodedKey,
  });
  return runWithSecret(secret);
}
