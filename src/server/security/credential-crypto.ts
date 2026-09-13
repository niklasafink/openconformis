import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { AiCredentialPurpose, AiRouteProvider } from "@/domain/ai/provider";
import { configuredValue } from "@/server/environment";

const algorithm = "aes-256-gcm";
const nonceBytes = 12;

export type CredentialBinding = {
  credentialId: string;
  ownerUserId: string;
  sessionId: string;
  provider: AiRouteProvider;
  purpose: AiCredentialPurpose;
  bindingId: string;
  expiresAt: string;
};

/** Bindung eines dauerhaft gespeicherten Schlüssels: nur Nutzer und Anbieter, keine Sitzung. */
export type SavedCredentialBinding = {
  kind: "saved";
  credentialId: string;
  ownerUserId: string;
  provider: AiRouteProvider;
};

export type EncryptedCredential = {
  ciphertext: string;
  nonce: string;
  authenticationTag: string;
  keyVersion: number;
};

function decodeEncryptionKey(encodedKey: string) {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encodedKey)) {
    throw new Error("BYOK_ENCRYPTION_KEY_INVALID");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("BYOK_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

function associatedData(binding: CredentialBinding | SavedCredentialBinding) {
  if ("kind" in binding) {
    return Buffer.from(
      JSON.stringify({
        kind: binding.kind,
        credentialId: binding.credentialId,
        ownerUserId: binding.ownerUserId,
        provider: binding.provider,
      }),
      "utf8",
    );
  }
  return Buffer.from(
    JSON.stringify({
      credentialId: binding.credentialId,
      ownerUserId: binding.ownerUserId,
      sessionId: binding.sessionId,
      provider: binding.provider,
      purpose: binding.purpose,
      bindingId: binding.bindingId,
      expiresAt: binding.expiresAt,
    }),
    "utf8",
  );
}

export function activeCredentialEncryptionConfiguration() {
  // Mitkopierte Anführungszeichen („"1"") ließen parseInt NaN liefern und
  // sperrten jede Schlüsselverbindung mit einem stummen Serverfehler.
  const encodedKey = configuredValue("BYOK_ENCRYPTION_KEY");
  const keyVersion = Number.parseInt(configuredValue("BYOK_ENCRYPTION_KEY_VERSION"), 10);
  if (!encodedKey || !Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new Error("BYOK_ENCRYPTION_NOT_CONFIGURED");
  }
  return { encodedKey, keyVersion };
}

export function encryptCredentialSecret(input: {
  secret: string;
  binding: CredentialBinding | SavedCredentialBinding;
  encodedKey: string;
  keyVersion: number;
}): EncryptedCredential {
  if (!input.secret.trim() || input.secret.length > 32_768) {
    throw new Error("BYOK_SECRET_INVALID");
  }
  if (!Number.isSafeInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("BYOK_KEY_VERSION_INVALID");
  }
  const nonce = randomBytes(nonceBytes);
  const cipher = createCipheriv(algorithm, decodeEncryptionKey(input.encodedKey), nonce);
  cipher.setAAD(associatedData(input.binding));
  const ciphertext = Buffer.concat([cipher.update(input.secret, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    keyVersion: input.keyVersion,
  };
}

export function decryptCredentialSecret(input: {
  encrypted: EncryptedCredential;
  binding: CredentialBinding | SavedCredentialBinding;
  encodedKey: string;
}) {
  const nonce = Buffer.from(input.encrypted.nonce, "base64");
  const authenticationTag = Buffer.from(input.encrypted.authenticationTag, "base64");
  const ciphertext = Buffer.from(input.encrypted.ciphertext, "base64");
  if (nonce.length !== nonceBytes || authenticationTag.length !== 16 || ciphertext.length === 0) {
    throw new Error("BYOK_CIPHERTEXT_INVALID");
  }

  try {
    const decipher = createDecipheriv(algorithm, decodeEncryptionKey(input.encodedKey), nonce);
    decipher.setAAD(associatedData(input.binding));
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("BYOK_CIPHERTEXT_INVALID");
  }
}
