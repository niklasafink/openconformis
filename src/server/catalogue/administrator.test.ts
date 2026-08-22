import { describe, expect, it } from "vitest";

import type { SessionPrincipal } from "@/server/auth/session-principal";

import { isBootstrapCatalogueAdministrator } from "./administrator-policy";

const principal: SessionPrincipal = {
  userId: "user-1",
  email: "info@conformisgrc.com",
  emailVerified: true,
  organizationId: "org-1",
  membershipId: "membership-1",
  role: "owner",
  roles: ["owner"],
};

describe("catalogue administrator bootstrap", () => {
  it("matches verified e-mail addresses case-insensitively", () => {
    expect(
      isBootstrapCatalogueAdministrator(principal, "admin@example.com, INFO@CONFORMISGRC.COM"),
    ).toBe(true);
  });

  it("never bootstraps an unverified account", () => {
    expect(
      isBootstrapCatalogueAdministrator(
        { ...principal, emailVerified: false },
        "info@conformisgrc.com",
      ),
    ).toBe(false);
  });
});
