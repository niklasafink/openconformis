import "server-only";

import { asc, eq } from "drizzle-orm";

import { requireAuthenticatedSessionUser } from "@/server/auth/session-user";
import { ensurePersonalWorkspaceForUser } from "@/server/auth/personal-workspace";
import { parseApplicationRoles } from "@/server/auth/principal-roles";
import type { ApplicationRole } from "@/server/auth/permissions";
import { db } from "@/server/db/client";
import { members } from "@/server/db/schema/auth";

/**
 * Wer die Vertragsprüfung bedient: der angemeldete Nutzer, sein Arbeitsbereich und
 * seine Rollen. Wie beim Analysestart über `requireAuthenticatedSessionUser`, damit
 * auch die lokale Anmeldeumgehung der E2E-Prüfung einen Arbeitsbereich bekommt.
 */
export type ReviewActor = {
  userId: string;
  emailVerified: boolean;
  organizationId: string;
  roles: ApplicationRole[];
};

async function readMembership(userId: string) {
  const [membership] = await db
    .select({ organizationId: members.organizationId, role: members.role })
    .from(members)
    .where(eq(members.userId, userId))
    .orderBy(asc(members.createdAt))
    .limit(1);
  return membership;
}

export async function resolveReviewActor(): Promise<ReviewActor> {
  const user = await requireAuthenticatedSessionUser();
  let membership = await readMembership(user.id);
  if (!membership) {
    await ensurePersonalWorkspaceForUser({ id: user.id, name: user.name, email: user.email });
    membership = await readMembership(user.id);
  }
  if (!membership) throw new ReviewAccessError("MEMBERSHIP_REQUIRED");
  return {
    userId: user.id,
    emailVerified: user.emailVerified,
    organizationId: membership.organizationId,
    roles: parseApplicationRoles(membership.role),
  };
}

export class ReviewAccessError extends Error {
  constructor(
    public readonly code: "MEMBERSHIP_REQUIRED" | "REVIEW_FORBIDDEN" | "VERIFIED_EMAIL_REQUIRED",
  ) {
    super(code);
    this.name = "ReviewAccessError";
  }
}

const managementRoles: readonly ApplicationRole[] = ["owner", "admin", "analyst"];
/** Dieselben Rollen wie in der Gap-Analyse. */
const confirmationRoles: readonly ApplicationRole[] = ["owner", "admin", "reviewer"];
const overrideRoles: readonly ApplicationRole[] = ["owner", "admin", "analyst", "reviewer"];

function require(
  actor: ReviewActor,
  allowed: readonly ApplicationRole[],
  needsVerifiedEmail: boolean,
) {
  if (needsVerifiedEmail && !actor.emailVerified)
    throw new ReviewAccessError("VERIFIED_EMAIL_REQUIRED");
  if (!actor.roles.some((role) => allowed.includes(role)))
    throw new ReviewAccessError("REVIEW_FORBIDDEN");
  return actor;
}

/** Was die Oberfläche einem Akteur anbietet — dieselben Regeln wie die Prüfungen. */
export function reviewPermissionsOf(actor: ReviewActor) {
  const has = (allowed: readonly ApplicationRole[]) =>
    actor.roles.some((role) => allowed.includes(role));
  return {
    canManage: has(managementRoles),
    canConfirm: actor.emailVerified && has(confirmationRoles),
    canOverride: actor.emailVerified && has(overrideRoles),
  };
}

/** Tabellen, Spalten und Dokumente verwalten, Läufe starten und abbrechen. */
export function requireManagement(actor: ReviewActor) {
  return require(actor, managementRoles, false);
}
export function requireConfirmation(actor: ReviewActor) {
  return require(actor, confirmationRoles, true);
}
export function requireOverride(actor: ReviewActor) {
  return require(actor, overrideRoles, true);
}
