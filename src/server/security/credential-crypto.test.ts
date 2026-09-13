// @vitest-environment node

import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptCredentialSecret, encryptCredentialSecret } from "./credential-crypto";

const encodedKey = randomBytes(32).toString("base64");
const binding = {
  credentialId: "ba2be85d-49d7-4467-a5ca-a34e15f5a064",
  ownerUserId: "user-1",
  sessionId: "session-1",
  provider: "anthropic" as const,
  purpose: "analysis" as const,
  bindingId: "draft-1",
  expiresAt: "2026-08-23T10:00:00.000Z",
};

describe("temporary credential encryption", () => {
  it("round-trips only with the exact authenticated binding", () => {
    const encrypted = encryptCredentialSecret({
      secret: "credential-canary-value",
      binding,
      encodedKey,
      keyVersion: 3,
    });

    expect(decryptCredentialSecret({ encrypted, binding, encodedKey })).toBe(
      "credential-canary-value",
    );
    expect(JSON.stringify(encrypted)).not.toContain("credential-canary-value");
  });

  it("rejects tampered ciphertext and a different owner binding", () => {
    const encrypted = encryptCredentialSecret({
      secret: "credential-canary-value",
      binding,
      encodedKey,
      keyVersion: 1,
    });
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
    };

    expect(() => decryptCredentialSecret({ encrypted: tampered, binding, encodedKey })).toThrow(
      "BYOK_CIPHERTEXT_INVALID",
    );
    expect(() =>
      decryptCredentialSecret({
        encrypted,
        binding: { ...binding, ownerUserId: "user-2" },
        encodedKey,
      }),
    ).toThrow("BYOK_CIPHERTEXT_INVALID");
  });

  it("rejects malformed encryption material", () => {
    expect(() =>
      encryptCredentialSecret({
        secret: "credential-canary-value",
        binding,
        encodedKey: "not-a-key",
        keyVersion: 1,
      }),
    ).toThrow("BYOK_ENCRYPTION_KEY_INVALID");
  });
});

describe("saved credential encryption", () => {
  const savedBinding = {
    kind: "saved" as const,
    credentialId: "5f0e3a1c-7b2d-4c8e-9f6a-1d2b3c4d5e6f",
    ownerUserId: "user-1",
    provider: "openrouter" as const,
  };

  it("round-trips a saved key for its owner and provider only", () => {
    const encrypted = encryptCredentialSecret({
      secret: "saved-canary-value",
      binding: savedBinding,
      encodedKey,
      keyVersion: 1,
    });

    expect(decryptCredentialSecret({ encrypted, binding: savedBinding, encodedKey })).toBe(
      "saved-canary-value",
    );
    expect(() =>
      decryptCredentialSecret({
        encrypted,
        binding: { ...savedBinding, ownerUserId: "user-2" },
        encodedKey,
      }),
    ).toThrow("BYOK_CIPHERTEXT_INVALID");
    // Ein gespeicherter Schlüssel lässt sich nicht als kurzlebiger Lauf-Schlüssel lesen.
    expect(() =>
      decryptCredentialSecret({
        encrypted,
        binding: { ...binding, credentialId: savedBinding.credentialId },
        encodedKey,
      }),
    ).toThrow("BYOK_CIPHERTEXT_INVALID");
  });
});
