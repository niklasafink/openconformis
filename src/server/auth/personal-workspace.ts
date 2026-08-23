import "server-only";

import { randomUUID } from "node:crypto";

import { asc, eq, sql } from "drizzle-orm";

import { routing } from "@/i18n/routing";
import { db } from "@/server/db/client";
import { members, organizations } from "@/server/db/schema/auth";

type DatabaseTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export type WorkspaceOwner = {
  id: string;
  name: string;
  email: string;
};

export function workspaceSlug(email: string, userId: string) {
  const prefix = email
    .split("@")[0]
    ?.toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 32);
  return `${prefix || "workspace"}-${userId
    .replace(/[^a-z0-9]/giu, "")
    .slice(-10)
    .toLowerCase()}-${randomUUID().slice(0, 6)}`;
}

/**
 * Liefert den persönlichen Arbeitsbereich eines Nutzers und legt ihn an, falls er
 * fehlt.
 *
 * Muss innerhalb einer Transaktion laufen, die bereits den Advisory Lock auf die
 * Nutzer-ID hält — sonst können zwei gleichzeitige Requests desselben Nutzers zwei
 * Organisationen erzeugen, und welche davon gewinnt, entscheidet danach die
 * Sortierung nach `createdAt`.
 */
export async function ensurePersonalWorkspace(
  transaction: DatabaseTransaction,
  owner: WorkspaceOwner,
  defaultLocale: string = routing.defaultLocale,
): Promise<{ organizationId: string }> {
  const [membership] = await transaction
    .select({ organizationId: members.organizationId })
    .from(members)
    .where(eq(members.userId, owner.id))
    .orderBy(asc(members.createdAt))
    .limit(1);
  if (membership) return membership;

  const organizationId = randomUUID();
  const createdAt = new Date();

  await transaction.insert(organizations).values({
    id: organizationId,
    name: owner.name.trim() || "Mein Arbeitsbereich",
    slug: workspaceSlug(owner.email, owner.id),
    createdAt,
    deploymentProfile: "hosted-beta",
    defaultLocale,
    retentionDays: 30,
  });
  await transaction.insert(members).values({
    id: randomUUID(),
    organizationId,
    userId: owner.id,
    role: "owner",
    createdAt,
  });

  return { organizationId };
}

/**
 * Wie {@link ensurePersonalWorkspace}, aber mit eigener Transaktion und Advisory
 * Lock. Für Aufrufer, die nicht ohnehin schon in einer Transaktion stehen.
 */
export async function ensurePersonalWorkspaceForUser(
  owner: WorkspaceOwner,
  defaultLocale: string = routing.defaultLocale,
) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${owner.id}, 0))`);
    return ensurePersonalWorkspace(transaction, owner, defaultLocale);
  });
}
