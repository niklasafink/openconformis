import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { members } from "@/server/db/schema/auth";

import { auth, isAuthenticationConfigured } from "./index";
import { ensureApplicationUser } from "./identity-projection";
import { ensurePersonalWorkspaceForUser } from "./personal-workspace";
import {
  highestApplicationRole,
  MembershipRequiredError,
  parseApplicationRoles,
  type SessionPrincipal,
} from "./principal-roles";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

async function readFirstMembership(userId: string) {
  const [membership] = await db
    .select({
      id: members.id,
      organizationId: members.organizationId,
      role: members.role,
    })
    .from(members)
    .where(eq(members.userId, userId))
    .orderBy(asc(members.createdAt))
    .limit(1);

  return membership;
}

export async function requireSessionPrincipal(): Promise<SessionPrincipal> {
  if (!isAuthenticationConfigured) throw new AuthenticationRequiredError();

  const { data: session, error } = await auth.getSession();

  if (error || !session?.user || !session.session) {
    throw new AuthenticationRequiredError();
  }

  await ensureApplicationUser(session.user);

  let membership = await readFirstMembership(session.user.id);

  if (!membership) {
    // Der persönliche Arbeitsbereich entstand bisher erst beim Analysestart. Wer
    // sich anmeldete und zuerst in den Chat ging, hatte keine Organisation und
    // damit keinen Zugriff auf eine Fläche, die ihm offensteht.
    await ensurePersonalWorkspaceForUser({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    });
    membership = await readFirstMembership(session.user.id);
  }

  if (!membership) {
    throw new MembershipRequiredError();
  }

  const roles = parseApplicationRoles(membership.role);

  return {
    userId: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: highestApplicationRole(roles),
    roles,
  };
}

export type { SessionPrincipal } from "./principal-roles";
export {
  AuthorizationDeniedError,
  highestApplicationRole,
  MembershipRequiredError,
  parseApplicationRoles,
  requireAnyRole,
} from "./principal-roles";
