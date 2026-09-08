// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existing: vi.fn(),
  launch: vi.fn(),
  draft: vi.fn(),
  user: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  isDatabaseConfigured: true,
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.existing }) }) }) },
}));
vi.mock("@/server/auth/session-user", () => ({ requireAuthenticatedSessionUser: mocks.user }));
vi.mock("@/server/drafts/framework-selection", () => ({ getBoundActiveDraft: mocks.draft }));
vi.mock("@/server/workflows/launch", () => ({ launchAnalysisWorkflow: mocks.launch }));
vi.mock("@/server/ai/analysis-instruction-service", () => ({
  getActiveAnalysisInstructionPair: vi.fn(),
}));
import { startAnalysis } from "./start-analysis";

const input = {
  draftId: "dd3441d7-2f6b-4d4d-93c4-2f0cc1b87fb2",
  credentialId: "9623bb45-edda-401b-8866-85809c8d323f",
};

describe("analysis start recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ id: "owner", sessionId: "session" });
  });

  it("requires a credential at the service boundary, including retries", async () => {
    await expect(startAnalysis({ ...input, credentialId: "" })).rejects.toThrow();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("recovers a committed run after a launch failure without requiring the claimed draft", async () => {
    mocks.existing.mockResolvedValue([{ id: "analysis", status: "queued" }]);
    mocks.launch
      .mockRejectedValueOnce(new Error("launch unavailable"))
      .mockResolvedValueOnce({ runId: "run" });
    await expect(startAnalysis(input)).rejects.toThrow("launch unavailable");
    await expect(startAnalysis(input)).resolves.toEqual({
      analysisId: "analysis",
      status: "queued",
      reused: true,
    });
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it.each(["running", "completed", "failed", "cancelled"])(
    "does not relaunch a %s run",
    async (status) => {
      mocks.existing.mockResolvedValue([{ id: "analysis", status }]);
      await expect(startAnalysis(input)).resolves.toMatchObject({
        analysisId: "analysis",
        status,
        reused: true,
      });
      expect(mocks.launch).not.toHaveBeenCalled();
    },
  );
});
