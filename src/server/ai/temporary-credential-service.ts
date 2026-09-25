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
import { readSavedCredentialSecret, saveUserCredential } from "./saved-credential-service";
import {
  allowedByokProviders,
  analysisVerifierModelId,
  getAnalysisProviderConfiguration,
  isAnalysisProviderAvailable,
} from "./provider-routing";

export class TemporaryCredentialError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TemporaryCredentialError";
  }
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

type CredentialConnectInput = {
  provider: string;
  purpose: string;
  bindingId: string;
  requiredModelId: string;
  /** Ohne Angabe gilt der gespeicherte Schlüssel des Nutzers für diesen Anbieter. */
  secret?: string;
};

type SessionUser = Awaited<ReturnType<typeof requireAuthenticatedSessionUser>>;

export async function createTemporaryCredential(input: CredentialConnectInput) {
  return connectTemporaryCredential(input, async (user, purpose) => {
    if (purpose !== "analysis") return user.sessionId;
    const boundDraft = await getBoundActiveDraft(input.bindingId);
    if (!boundDraft || boundDraft.id !== input.bindingId) {
      throw new TemporaryCredentialError("BYOK_BINDING_NOT_FOUND");
    }
    return boundDraft.id;
  });
}

/**
 * Schlüssel für den Neustart einer Analyse. Den Draft des neuen Laufs legt der
 * Server selbst an, einen Bindungs-Cookie gibt es dafür nicht. Der Aufrufer muss
 * das Eigentum an der Ausgangsanalyse vorher geprüft haben.
 */
export async function createRerunAnalysisCredential(
  input: Omit<CredentialConnectInput, "purpose">,
) {
  return connectTemporaryCredential({ ...input, purpose: "analysis" }, async () => input.bindingId);
}

/**
 * Kurzlebiger Schlüssel für einen Prüflauf der Vertragsprüfung. Ein Lauf hält zwei —
 * Routing und Eskalation —, beide an dieselbe `bindingId` (die Lauf-ID) gebunden und
 * durch den **Zweck** unterschieden. Die Lauf-ID erzeugt der Server selbst vor dem
 * Start, einen Bindungs-Cookie gibt es dafür nicht; der Aufrufer besitzt sie, weil er
 * sie eben erst vergeben hat.
 */
export async function createReviewRunCredential(input: {
  provider: string;
  purpose: "review_routing" | "review_escalation";
  bindingId: string;
  requiredModelId: string;
  /** Ohne Angabe gilt der gespeicherte Schlüssel des Nutzers für diesen Anbieter. */
  secret?: string;
}) {
  return connectTemporaryCredential(input, async () => input.bindingId);
}

/**
 * Kurzlebiger Schlüssel für die Einordnung eines Plausicheck-Laufs der
 * Offenlegungspflicht über das Nutzermodell, gebunden an die Lauf-ID. Er stammt immer
 * aus dem gespeicherten Schlüssel des Nutzers; einen Schlüssel im Start-Body gibt es
 * nicht. Der Aufrufer besitzt die Lauf-ID, weil er sie eben erst vergeben hat.
 */
export async function createDisclosureRunCredential(input: {
  provider: string;
  bindingId: string;
  requiredModelId: string;
}) {
  return connectTemporaryCredential(
    { ...input, purpose: "disclosure" },
    async () => input.bindingId,
  );
}

/**
 * Kurzlebiger TypeSafe-Schlüssel für die optionale Jev-Hilfe einer Analyse, gebunden
 * an den Draft des Laufs. Er stammt immer aus dem gespeicherten Schlüssel des Nutzers:
 * einen Betreiber-Schlüssel gibt es nicht, und ein Schlüssel in einer Anfrage würde
 * durch Workflow-Payloads laufen. Der Aufrufer besitzt den Draft, weil er ihn eben
 * erst geprüft oder angelegt hat.
 */
export async function createAnalysisAssistCredential(input: {
  bindingId: string;
  requiredModelId: string;
}) {
  return connectTemporaryCredential(
    { ...input, provider: "typesafe", purpose: "analysis_assist" },
    async () => input.bindingId,
  );
}

/**
 * Prüft einen eingegebenen Schlüssel beim Anbieter und speichert ihn dauerhaft,
 * ohne eine Analyse zu verbinden oder zu starten. Der Start leitet später
 * seinen kurzlebigen Schlüssel aus dem gespeicherten ab.
 */
export async function verifyAndSaveUserCredential(input: {
  provider: string;
  requiredModelId: string;
  secret: string;
}) {
  const user = await requireAuthenticatedSessionUser();
  const provider = aiRouteProviderSchema.parse(input.provider);
  const secret = input.secret.trim();
  if (
    secret.length < 8 ||
    secret.length > 20_000 ||
    !input.requiredModelId.trim() ||
    input.requiredModelId.length > 300
  ) {
    throw new TemporaryCredentialError("BYOK_INPUT_INVALID");
  }
  if (!allowedByokProviders().has(provider)) {
    throw new TemporaryCredentialError("BYOK_PROVIDER_DISABLED");
  }
  if (!isAnalysisProviderAvailable(provider)) {
    throw new TemporaryCredentialError("BYOK_PRIVACY_ROUTE_UNAVAILABLE");
  }

  await validateProviderCredential({
    provider,
    secret,
    requiredModelId: input.requiredModelId,
    route: getAnalysisProviderConfiguration(provider),
  });
  await db.transaction((transaction) =>
    saveUserCredential(transaction, { ownerUserId: user.id, provider, secret }),
  );
  return { provider, lastFour: secret.slice(-4) };
}

async function connectTemporaryCredential(
  input: CredentialConnectInput,
  resolveBindingId: (user: SessionUser, purpose: AiCredentialPurpose) => Promise<string>,
) {
  const user = await requireAuthenticatedSessionUser();
  const provider = aiRouteProviderSchema.parse(input.provider);
  const purpose = aiCredentialPurposeSchema.parse(input.purpose);
  // Ein eingegebener Schlüssel hat Vorrang und wird nach der Prüfung gespeichert;
  // sonst kommt der gespeicherte Schlüssel zum Einsatz.
  const typedSecret = input.secret?.trim() ? input.secret : undefined;
  const secret =
    typedSecret ?? (await readSavedCredentialSecret({ ownerUserId: user.id, provider }));
  if (!secret) throw new TemporaryCredentialError("BYOK_SAVED_CREDENTIAL_NOT_FOUND");
  if (
    secret.length < 8 ||
    secret.length > 20_000 ||
    !input.requiredModelId.trim() ||
    input.requiredModelId.length > 300
  ) {
    throw new TemporaryCredentialError("BYOK_INPUT_INVALID");
  }
  if (!allowedByokProviders().has(provider)) {
    throw new TemporaryCredentialError("BYOK_PROVIDER_DISABLED");
  }
  // Die Eskalation ruft das grosse Modell über dieselbe Route wie eine Analyse und
  // braucht deshalb dieselbe Prüfung. Das Routing läuft über Jev, das nie eine
  // Analyse-Route ist; im Modellmodus trägt es dagegen die BYOK-Route des Modells.
  const usesAnalysisRoute =
    purpose === "analysis" ||
    purpose === "review_escalation" ||
    purpose === "disclosure" ||
    (purpose === "review_routing" && isAnalysisProviderAvailable(provider));
  if (usesAnalysisRoute && !isAnalysisProviderAvailable(provider)) {
    throw new TemporaryCredentialError("BYOK_PRIVACY_ROUTE_UNAVAILABLE");
  }

  const bindingId = await resolveBindingId(user, purpose);

  const validation = await validateProviderCredential({
    provider,
    secret,
    requiredModelId: input.requiredModelId,
    route: usesAnalysisRoute ? getAnalysisProviderConfiguration(provider) : undefined,
  });
  // Die Verifikation einer Analyse läuft über denselben Schlüssel mit einem festen
  // zweiten Modell. Ist es dem Schlüssel nicht zugänglich, soll der Start hier
  // scheitern und nicht erst die erste Verifikation mitten im Lauf.
  const verifierModelId = analysisVerifierModelId(provider, input.requiredModelId);
  if (purpose === "analysis" && verifierModelId !== input.requiredModelId) {
    await validateProviderCredential({
      provider,
      secret,
      requiredModelId: verifierModelId,
      route: getAnalysisProviderConfiguration(provider),
    });
  }
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
    secret,
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
      secretLastFour: secret.slice(-4),
      safeLabel,
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
      },
    });
    if (typedSecret) {
      await saveUserCredential(transaction, {
        ownerUserId: user.id,
        provider,
        secret: typedSecret,
      });
    }
  });

  return {
    credentialId,
    provider,
    purpose,
    lastFour: secret.slice(-4),
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
      // Das Ergebnis zeigt die Verbindung je Draft an; ohne die Bindung ließe
      // sich ein Schlüssel eines anderen Drafts nicht davon unterscheiden.
      bindingId: aiCredentials.bindingId,
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
