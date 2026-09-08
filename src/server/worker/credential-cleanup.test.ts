// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/server/db/client", () => {
  const transaction = {
    execute: vi.fn(),
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.load }) }) }),
  };
  return {
    db: { ...transaction, transaction: (run: (tx: unknown) => unknown) => run(transaction) },
  };
});
vi.mock("@/server/ai/credential-cleanup", () => ({
  deleteTemporaryCredentialsForBinding: mocks.cleanup,
}));
vi.mock("@/server/ai/analysis-instruction-service", () => ({
  getFrozenAnalysisInstruction: vi.fn(),
}));
vi.mock("@/server/ai/provider-routing", () => ({
  isAnalysisProviderAvailable: () => true,
  getAnalysisProviderConfiguration: () => ({ privacyProfileId: "eu-zdr-v1" }),
}));
vi.mock("./retrieve-analysis", () => ({ prepareAnalysisRetrieval: vi.fn() }));
import { finalizeAnalysisExecution } from "./execute-analysis";
import { markAnalysisRetriesExhausted } from "./fail-analysis";

describe("temporary credential cleanup after completion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.load.mockResolvedValue([
      {
        id: "analysis",
        status: "completed",
        routeProvider: "openrouter",
        privacyProfileId: "eu-zdr-v1",
        sourceDraftId: "draft",
        ownerUserId: "owner",
      },
    ]);
  });

  it("retries deletion even when completion was already committed", async () => {
    mocks.cleanup.mockRejectedValueOnce(new Error("database unavailable")).mockResolvedValueOnce(1);
    await expect(finalizeAnalysisExecution("analysis")).rejects.toThrow("database unavailable");
    await expect(finalizeAnalysisExecution("analysis")).resolves.toMatchObject({
      status: "completed",
    });
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
    expect(mocks.cleanup).toHaveBeenLastCalledWith({
      purpose: "analysis",
      bindingId: "draft",
      ownerUserId: "owner",
    });
  });

  it("also cleans completed runs when the finalization step exhausted its retries", async () => {
    await expect(markAnalysisRetriesExhausted("analysis")).resolves.toEqual({ changed: false });
    expect(mocks.cleanup).toHaveBeenCalledWith({
      purpose: "analysis",
      bindingId: "draft",
      ownerUserId: "owner",
    });
  });
});
