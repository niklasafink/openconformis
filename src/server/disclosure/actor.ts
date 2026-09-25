import "server-only";

import type { ApplicationRole } from "@/server/auth/permissions";
import { resolveReviewActor, type ReviewActor } from "@/server/review/review-actor";

/**
 * Wer die Offenlegungspflicht bedient. Derselbe Akteur wie in der Vertragsprüfung:
 * angemeldeter Nutzer, sein Arbeitsbereich und seine Rollen. Die Rollen des
 * Vier-Augen-Prinzips (Entscheidung des Nutzers vom 2026-09-25):
 *
 * - Prüfer: owner, admin, analyst, reviewer — `viewer` bleibt lesend.
 * - Manager: owner, admin.
 */
export type DisclosureActor = ReviewActor;

export const preparerRoles: readonly ApplicationRole[] = ["owner", "admin", "analyst", "reviewer"];
export const managerRoles: readonly ApplicationRole[] = ["owner", "admin"];

export class DisclosureAccessError extends Error {
  constructor(public readonly code: "DISCLOSURE_FORBIDDEN" | "MEMBERSHIP_REQUIRED") {
    super(code);
    this.name = "DisclosureAccessError";
  }
}

export async function resolveDisclosureActor(): Promise<DisclosureActor> {
  return resolveReviewActor();
}

function has(actor: DisclosureActor, allowed: readonly ApplicationRole[]) {
  return actor.roles.some((role) => allowed.includes(role));
}

/** Prüfungen anlegen, Dokumente hinzufügen, Läufe starten, Stufe 1 der Freigabe. */
export function requirePreparer(actor: DisclosureActor) {
  if (!has(actor, preparerRoles)) throw new DisclosureAccessError("DISCLOSURE_FORBIDDEN");
  return actor;
}

/** Stufe 2 der Freigabe. */
export function requireManager(actor: DisclosureActor) {
  if (!has(actor, managerRoles)) throw new DisclosureAccessError("DISCLOSURE_FORBIDDEN");
  return actor;
}

export function disclosurePermissionsOf(actor: DisclosureActor) {
  return { canPrepare: has(actor, preparerRoles), canRelease: has(actor, managerRoles) };
}
