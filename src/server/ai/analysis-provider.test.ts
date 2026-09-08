// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ credential: vi.fn(), request: vi.fn() }));
vi.mock("./temporary-credential-service", () => ({
  withTemporaryCredential: mocks.credential,
  TemporaryCredentialError: class extends Error {},
}));
vi.mock("./provider-routing", () => ({
  getAnalysisProviderConfiguration: () => ({
    baseUrl: "https://openrouter.ai/api/v1",
    maxOutputTokens: 4000,
    zeroDataRetention: true,
  }),
  requestProviderStructured: mocks.request,
}));
import { requestStructuredForAnalysis } from "./analysis-provider";

const analysis = {
  aiCredentialId: "credential-id",
  ownerUserId: "owner-id",
  routeProvider: "openrouter" as const,
  sourceDraftId: "draft-id",
};
const request = {
  modelId: "selected-model",
  system: "system",
  user: "policy",
  schemaName: "result",
  jsonSchema: {},
  outputSchema: z.object({ answer: z.string() }),
};

describe("analysis always uses its owner's temporary credential", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a missing credential even if an operator key exists", async () => {
    vi.stubEnv("OPERATOR_OPENROUTER_API_KEY", "must-never-be-used");
    await expect(
      requestStructuredForAnalysis({ ...analysis, aiCredentialId: null }, request),
    ).rejects.toThrow("ANALYSIS_CREDENTIAL_MISSING");
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("binds assessment and verification calls to the owner, draft, provider and exact model", async () => {
    mocks.credential.mockImplementation(async (_, useSecret) => useSecret("own-key"));
    await requestStructuredForAnalysis(analysis, request);
    expect(mocks.credential).toHaveBeenCalledWith(
      {
        credentialId: "credential-id",
        ownerUserId: "owner-id",
        provider: "openrouter",
        purpose: "analysis",
        bindingId: "draft-id",
        requiredModelId: "selected-model",
      },
      expect.any(Function),
    );
    expect(mocks.request).toHaveBeenCalledWith(
      "openrouter",
      expect.objectContaining({ apiKey: "own-key" }),
    );
  });

  it("never calls a provider when the credential is expired or revoked", async () => {
    mocks.credential.mockRejectedValue(new Error("BYOK_CREDENTIAL_NOT_FOUND"));
    await expect(requestStructuredForAnalysis(analysis, request)).rejects.toThrow(
      "BYOK_CREDENTIAL_NOT_FOUND",
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
