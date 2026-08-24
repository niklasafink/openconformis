// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureApplicationUser: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("./index", () => ({
  auth: { getSession: mocks.getSession },
  isAuthenticationConfigured: true,
}));

vi.mock("./identity-projection", () => ({
  ensureApplicationUser: mocks.ensureApplicationUser,
}));

import {
  requireAuthenticatedSessionUser,
  requireVerifiedSessionUser,
  VerifiedEmailRequiredError,
} from "./session-user";

const unverifiedSession = {
  data: {
    session: { id: "session-1" },
    user: {
      id: "user-1",
      name: "New user",
      email: "new@example.com",
      emailVerified: false,
      image: null,
    },
  },
  error: null,
};

describe("authenticated application sessions", () => {
  beforeEach(() => {
    delete process.env.LOCAL_AUTH_BYPASS;
    mocks.ensureApplicationUser.mockReset();
    mocks.getSession.mockReset();
    mocks.getSession.mockResolvedValue(unverifiedSession);
  });

  it("admits a newly registered password user into their protected workspace", async () => {
    await expect(requireAuthenticatedSessionUser()).resolves.toMatchObject({
      id: "user-1",
      sessionId: "session-1",
      emailVerified: false,
    });
    expect(mocks.ensureApplicationUser).toHaveBeenCalledWith(unverifiedSession.data.user);
  });

  it("uses an isolated local identity without a Neon Auth session in development", async () => {
    process.env.LOCAL_AUTH_BYPASS = "true";

    await expect(requireAuthenticatedSessionUser()).resolves.toMatchObject({
      id: "local-evaluation-user",
      sessionId: "local-evaluation-session",
      emailVerified: true,
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.ensureApplicationUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local-evaluation-user" }),
    );
  });

  it("still requires verification for legally relevant human approvals", async () => {
    await expect(requireVerifiedSessionUser()).rejects.toBeInstanceOf(VerifiedEmailRequiredError);
  });
});
