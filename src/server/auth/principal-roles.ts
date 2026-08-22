import { applicationRoles, type ApplicationRole } from "./permissions";

export class MembershipRequiredError extends Error {
  constructor() {
    super("An active organization membership is required.");
    this.name = "MembershipRequiredError";
  }
}

export class AuthorizationDeniedError extends Error {
  constructor() {
    super("The active membership does not grant this operation.");
    this.name = "AuthorizationDeniedError";
  }
}

export type SessionPrincipal = {
  userId: string;
  email: string;
  emailVerified: boolean;
  organizationId: string;
  membershipId: string;
  role: ApplicationRole;
  roles: ApplicationRole[];
};

export function parseApplicationRoles(value: string): ApplicationRole[] {
  const parsed = value
    .split(",")
    .map((role) => role.trim())
    .map((role) => (role === "member" ? "viewer" : role))
    .filter((role): role is ApplicationRole => applicationRoles.includes(role as ApplicationRole));

  return [...new Set(parsed)];
}

export function highestApplicationRole(roles: readonly ApplicationRole[]): ApplicationRole {
  const rolePriority: readonly ApplicationRole[] = [
    "owner",
    "admin",
    "analyst",
    "reviewer",
    "viewer",
  ];

  const role = rolePriority.find((candidate) => roles.includes(candidate));

  if (!role) {
    throw new MembershipRequiredError();
  }

  return role;
}

export function requireAnyRole(
  principal: SessionPrincipal,
  allowedRoles: readonly ApplicationRole[],
) {
  if (!principal.roles.some((role) => allowedRoles.includes(role))) {
    throw new AuthorizationDeniedError();
  }

  return principal;
}
