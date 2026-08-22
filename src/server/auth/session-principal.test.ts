import { describe, expect, it } from "vitest";

import {
  AuthorizationDeniedError,
  highestApplicationRole,
  parseApplicationRoles,
  requireAnyRole,
  type SessionPrincipal,
} from "./principal-roles";

const principal: SessionPrincipal = {
  userId: "user-1",
  email: "analyst@example.com",
  emailVerified: true,
  organizationId: "org-1",
  membershipId: "member-1",
  role: "analyst",
  roles: ["analyst"],
};

describe("session principal roles", () => {
  it("maps the compatibility member role to the application viewer role", () => {
    expect(parseApplicationRoles("member,reviewer")).toEqual(["viewer", "reviewer"]);
  });

  it("selects the most privileged application role", () => {
    expect(highestApplicationRole(["viewer", "admin"])).toBe("admin");
  });

  it("rejects a principal without one of the allowed roles", () => {
    expect(() => requireAnyRole(principal, ["owner", "admin"])).toThrow(AuthorizationDeniedError);
  });
});
