// @vitest-environment node

/**
 * Jev im Plausicheck bleibt abschaltbar und optional: bei `off` und ohne gespeicherten
 * TypeSafe-Schlüssel gibt es keinen einzigen TypeSafe-Aufruf, und der Start friert
 * `off` ein, statt zu scheitern. Anbieter und Schlüssel sind ersetzt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { systemOneModelId } from "@/domain/ai/system-one";
import { planAssignmentBatches } from "@/domain/disclosure/assignment";
import { disclosureJevPromptVersion, jevRouterModelId } from "@/domain/disclosure/jev-assignment";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  systemOne: vi.fn(),
  createCredential: vi.fn(),
  structured: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);
vi.mock("@/server/ai/typesafe", () => ({ requestSystemOne: mocks.systemOne }));
vi.mock("@/server/ai/jev-throttle", () => ({
  createJevThrottle: () => ({
    run: (_tokens: number, call: () => Promise<unknown>) => call(),
    penalize: () => undefined,
  }),
}));
vi.mock("./model-route", () => ({ requestStructuredForDisclosure: mocks.structured }));
vi.mock("@/server/ai/temporary-credential-service", () => ({
  TemporaryCredentialError: class TemporaryCredentialError extends Error {},
  createDisclosureAssistCredential: mocks.createCredential,
  withTemporaryCredential: (_input: unknown, work: (key: string) => Promise<unknown>) =>
    work("test-typesafe-key"),
}));
vi.mock("@/server/ai/credential-cleanup", () => ({ deleteTemporaryCredential: vi.fn() }));
vi.mock("@/server/auth/session-user", () => ({
  requireAuthenticatedSessionUser: async () => ({ id: "user-1" }),
}));

const { disclosureJevActive, prepareDisclosureJev, requestJevForBatch, requestJevRouterForBatch } =
  await import("./jev-route");

const [batch] = planAssignmentBatches(
  [
    {
      figureId: "f-1",
      blockId: "b-1",
      sentence: "Die Forderungen betragen TEUR 54.",
      start: 30,
      end: 32,
      candidates: [{ key: "forderungen_ll", label: "Forderungen aus Lieferungen und Leistungen" }],
    },
  ],
  { providerModelId: systemOneModelId, promptVersion: disclosureJevPromptVersion },
);

const onRun = {
  id: "run-1",
  ownerUserId: "user-1",
  jevAssist: "on" as const,
  jevModelId: systemOneModelId,
  assistCredentialId: "credential-1",
  routeProvider: "openai",
};

const routerRun = {
  ...onRun,
  jevModelId: jevRouterModelId,
  assistCredentialId: "credential-2",
  routeProvider: "openrouter",
  aiCredentialId: "credential-model",
  providerModelId: "openai/gpt-5.6-luna",
};

const missingKey = () =>
  Object.assign(new Error("BYOK_SAVED_CREDENTIAL_NOT_FOUND"), {
    code: "BYOK_SAVED_CREDENTIAL_NOT_FOUND",
  });

describe("Jev im Plausicheck", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.systemOne.mockReset();
    mocks.createCredential.mockReset();
    mocks.structured.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("macht bei DISCLOSURE_JEV_ASSIST=off keinen TypeSafe-Aufruf und friert off ein", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "off");
    expect(await prepareDisclosureJev("run-1")).toBeNull();
    expect(mocks.createCredential).not.toHaveBeenCalled();
    expect(mocks.systemOne).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("läuft ohne gespeicherten TypeSafe-Schlüssel ohne Fehler und ohne TypeSafe-Aufruf", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "");
    mocks.createCredential.mockRejectedValue(
      Object.assign(new Error("BYOK_SAVED_CREDENTIAL_NOT_FOUND"), {
        code: "BYOK_SAVED_CREDENTIAL_NOT_FOUND",
      }),
    );
    expect(await prepareDisclosureJev("run-1")).toBeNull();
    expect(mocks.createCredential).toHaveBeenCalledTimes(1);
    expect(mocks.systemOne).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("fällt bei einem unbekannten Schalterwert auf off zurück", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "Jev bitte");
    expect(await prepareDisclosureJev("run-1")).toBeNull();
    expect(mocks.createCredential).not.toHaveBeenCalled();
  });

  it("verbindet Jev standardmäßig, wenn ein Schlüssel gespeichert ist", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "");
    mocks.createCredential.mockResolvedValue({ credentialId: "credential-1" });
    expect(await prepareDisclosureJev("run-1")).toMatchObject({
      modelId: systemOneModelId,
      credentialId: "credential-1",
    });
    expect(mocks.createCredential).toHaveBeenCalledWith({
      bindingId: "run-1",
      requiredModelId: systemOneModelId,
      provider: "typesafe",
    });
  });

  it("nimmt ohne TypeSafe-Schlüssel den Jev Router, wenn das Modell über OpenRouter läuft", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "");
    mocks.createCredential
      .mockRejectedValueOnce(missingKey())
      .mockResolvedValueOnce({ credentialId: "credential-2" });
    expect(await prepareDisclosureJev("run-1", { routeProvider: "openrouter" })).toMatchObject({
      modelId: jevRouterModelId,
      credentialId: "credential-2",
    });
    expect(mocks.createCredential).toHaveBeenLastCalledWith({
      bindingId: "run-1",
      requiredModelId: jevRouterModelId,
      provider: "openrouter",
    });
    expect(mocks.systemOne).not.toHaveBeenCalled();
  });

  it("bleibt bei gespeichertem TypeSafe-Schlüssel auf Jev direkt, auch mit OpenRouter-Modell", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "");
    mocks.createCredential.mockResolvedValue({ credentialId: "credential-1" });
    expect(await prepareDisclosureJev("run-1", { routeProvider: "openrouter" })).toMatchObject({
      modelId: systemOneModelId,
    });
    expect(mocks.createCredential).toHaveBeenCalledTimes(1);
  });

  it("friert off ein, wenn weder TypeSafe-Schlüssel noch OpenRouter-Route vorliegen", async () => {
    vi.stubEnv("DISCLOSURE_JEV_ASSIST", "");
    mocks.createCredential.mockRejectedValue(missingKey());
    expect(await prepareDisclosureJev("run-1", { routeProvider: "openai" })).toBeNull();
    expect(mocks.createCredential).toHaveBeenCalledTimes(1);
  });

  it("fragt den Jev Router mit festem Modell und dem Jev-Schlüssel im Schema des Modells", async () => {
    const answer = {
      assignments: [
        { ref: "F1", candidate: "1", period: "current", confidencePercent: 90, comment: "" },
      ],
    };
    mocks.structured.mockResolvedValue({ output: answer, inputTokens: 300, outputTokens: 20 });
    expect(disclosureJevActive(routerRun)).toBe(true);
    const result = await requestJevRouterForBatch(routerRun, batch!);
    expect(result.answer).toEqual(answer);
    expect(mocks.structured).toHaveBeenCalledWith(
      routerRun,
      expect.objectContaining({
        user: expect.stringContaining("⟦54⟧"),
        timeoutMilliseconds: expect.any(Number),
      }),
      {
        credentialId: "credential-2",
        routeProvider: "openrouter",
        modelId: jevRouterModelId,
        purpose: "disclosure_assist",
        // Der Router lehnt einen vorgegebenen Denkaufwand mit HTTP 400 ab.
        omitReasoningEffort: true,
      },
    );
    expect(mocks.systemOne).not.toHaveBeenCalled();
  });

  it("nutzt den Jev Router nie ohne OpenRouter-Route", async () => {
    const detached = { ...routerRun, routeProvider: "openai" };
    expect(disclosureJevActive(detached)).toBe(false);
    await expect(requestJevRouterForBatch(detached, batch!)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_ROUTE",
    });
    expect(mocks.structured).not.toHaveBeenCalled();
  });

  it("fragt Jev bei einem als off eingefrorenen Lauf nie, auch mit Schlüssel-ID", async () => {
    const offRun = { ...onRun, jevAssist: "off" as const };
    expect(disclosureJevActive(offRun)).toBe(false);
    await expect(requestJevForBatch(offRun, batch!)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_ROUTE",
    });
    expect(mocks.systemOne).not.toHaveBeenCalled();
  });

  it("gibt Jevs Antworten je Kurzzeichen zurück", async () => {
    mocks.systemOne.mockResolvedValue({
      answers: {
        line_item: { type: "choice", choice: "c1", confidence: 0.9, probabilities: {} },
        period: { type: "choice", choice: "current", confidence: 0.9, probabilities: {} },
      },
      inputTokens: 120,
      outputTokens: 4,
    });
    const result = await requestJevForBatch(onRun, batch!);
    expect(result.answers.get("F1")?.line_item).toMatchObject({ choice: "c1" });
    expect(result.inputTokens).toBe(120);
    expect(mocks.systemOne).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-typesafe-key",
        state: expect.stringContaining("⟦54⟧"),
      }),
      expect.anything(),
    );
  });
});
