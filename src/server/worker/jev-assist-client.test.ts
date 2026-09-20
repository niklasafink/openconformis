// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  penalize: vi.fn(),
  inserted: [] as unknown[],
  updated: [] as unknown[],
  credentialInput: vi.fn(),
}));

vi.mock("@/server/ai/typesafe", () => ({ requestSystemOne: mocks.request }));
vi.mock("@/server/ai/temporary-credential-service", () => ({
  withTemporaryCredential: (input: unknown, work: (key: string) => Promise<unknown>) => {
    mocks.credentialInput(input);
    return work("secret-key");
  },
}));
vi.mock("@/server/db/client", () => {
  const chain = (record: unknown[]) => {
    const value: Record<string, unknown> = {};
    Object.assign(value, {
      values: (row: unknown) => (record.push(row), value),
      set: (row: unknown) => (record.push(row), value),
      where: () => value,
      returning: async () => [{ id: "invocation" }],
      then: (resolve: (result: unknown) => unknown) => Promise.resolve().then(resolve),
      catch: () => Promise.resolve(),
    });
    return value;
  };
  return { db: { insert: () => chain(mocks.inserted), update: () => chain(mocks.updated) } };
});

import { ModelProviderError } from "@/server/ai/structured-model";

import { createAnalysisJevAsk, type AnalysisJevBinding } from "./jev-assist-client";

const binding: AnalysisJevBinding = {
  id: "analysis",
  ownerUserId: "owner",
  sourceDraftId: "draft",
  jevAssistMode: "all",
  jevModelId: "jev-latest",
  jevCredentialId: "credential",
};
const throttle = {
  run: <T>(_tokens: number, call: () => Promise<T>) => call(),
  penalize: mocks.penalize,
};
const call = {
  scopeItemId: "scope",
  stage: "jev_citation" as const,
  state: "[1] Vertragstext",
  questions: {
    claim: {
      type: "noul" as const,
      instructions: "Is this text non-empty?",
      criteria: { true: "It has text.", false: "It is empty." },
    },
  },
};

describe("Jev access of a running analysis", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
  });

  it.each([
    ["off", { jevAssistMode: "off" }],
    ["an unknown mode", { jevAssistMode: "sometimes" }],
    ["a missing frozen key", { jevCredentialId: null }],
    ["a foreign model", { jevModelId: "other-model" }],
  ])("has no access with %s, so no request can ever be made", (_name, override) => {
    expect(createAnalysisJevAsk({ ...binding, ...override }, { throttle })).toBeUndefined();
  });

  it("binds the short-lived key to the draft and purpose, and logs no secret or policy text", async () => {
    mocks.request.mockResolvedValue({
      resolvedModelId: "jev-latest",
      answers: { claim: { type: "noul", noul: 0.9 } },
      inputTokens: 1_000_000,
      latencyMilliseconds: 12,
    });
    const answers = await createAnalysisJevAsk(binding, { throttle })!(call);
    expect(answers).toEqual({ claim: { type: "noul", noul: 0.9 } });
    expect(mocks.credentialInput).toHaveBeenCalledWith({
      credentialId: "credential",
      ownerUserId: "owner",
      provider: "typesafe",
      purpose: "analysis_assist",
      bindingId: "draft",
      requiredModelId: "jev-latest",
    });
    expect(mocks.updated[0]).toMatchObject({ status: "succeeded", costMicrounits: 42_000 });
    const logged = JSON.stringify([mocks.inserted, mocks.updated]);
    expect(logged).not.toContain("secret-key");
    expect(logged).not.toContain("Vertragstext");
  });

  it("answers nothing instead of failing, records the code and slows down on a rate limit", async () => {
    mocks.request.mockRejectedValue(new ModelProviderError("PROVIDER_RATE_LIMITED", true, "x", 7));
    await expect(createAnalysisJevAsk(binding, { throttle })!(call)).resolves.toBeUndefined();
    expect(mocks.penalize).toHaveBeenCalledWith(7);
    expect(mocks.updated[0]).toMatchObject({
      status: "failed",
      errorCode: "PROVIDER_RATE_LIMITED",
    });
  });

  it("answers nothing when the key is gone", async () => {
    mocks.credentialInput.mockImplementation(() => {
      throw new Error("BYOK_CREDENTIAL_NOT_FOUND");
    });
    await expect(createAnalysisJevAsk(binding, { throttle })!(call)).resolves.toBeUndefined();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
