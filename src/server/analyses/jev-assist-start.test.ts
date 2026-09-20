// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createCredential: vi.fn() }));
vi.mock("@/server/ai/temporary-credential-service", () => ({
  createAnalysisAssistCredential: mocks.createCredential,
}));

import { connectAnalysisJevAssist, jevAssistHashPart, jevAssistOff } from "./jev-assist-start";

class CodedError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

describe("freezing the Jev assist for a gap analysis", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does nothing at all when the switch is off", async () => {
    await expect(connectAnalysisJevAssist("draft")).resolves.toEqual(jevAssistOff);
    expect(mocks.createCredential).not.toHaveBeenCalled();
  });

  it("freezes the mode, model and short-lived key when the user has a saved key", async () => {
    vi.stubEnv("ANALYSIS_JEV_ASSIST", "all");
    mocks.createCredential.mockResolvedValue({ credentialId: "credential" });
    await expect(connectAnalysisJevAssist("draft")).resolves.toEqual({
      mode: "all",
      modelId: "jev-latest",
      credentialId: "credential",
    });
    expect(mocks.createCredential).toHaveBeenCalledWith({
      bindingId: "draft",
      requiredModelId: "jev-latest",
    });
  });

  it("runs as off, without an error and without a warning, when no TypeSafe key is saved", async () => {
    vi.stubEnv("ANALYSIS_JEV_ASSIST", "verification");
    mocks.createCredential.mockRejectedValue(new CodedError("BYOK_SAVED_CREDENTIAL_NOT_FOUND"));
    await expect(connectAnalysisJevAssist("draft")).resolves.toEqual(jevAssistOff);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("runs as off when TypeSafe rejects the saved key, and logs only the code", async () => {
    vi.stubEnv("ANALYSIS_JEV_ASSIST", "retrieval");
    mocks.createCredential.mockRejectedValue(new CodedError("CREDENTIAL_REJECTED"));
    await expect(connectAnalysisJevAssist("draft")).resolves.toEqual(jevAssistOff);
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), "CREDENTIAL_REJECTED");
  });

  it("leaves the configuration hash untouched for off", () => {
    expect(jevAssistHashPart(jevAssistOff)).toEqual({});
    expect(
      jevAssistHashPart({ mode: "all", modelId: "jev-latest", credentialId: "credential" }),
    ).toEqual({ jevAssist: { mode: "all", modelId: "jev-latest" } });
  });
});
