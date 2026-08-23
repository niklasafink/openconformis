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

  it("still requires verification for legally relevant human approvals", async () => {
    await expect(requireVerifiedSessionUser()).rejects.toBeInstanceOf(VerifiedEmailRequiredError);
  });
});
