import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { users } from "@/server/db/schema/auth";

export type NeonIdentity = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
};

export class IdentityProjectionConflictError extends Error {
  constructor() {
    super("The authenticated email is already linked to another application identity.");
    this.name = "IdentityProjectionConflictError";
  }
}

/**
 * Mirrors the managed Neon Auth identity into the application schema. Fachliche
 * tables keep their existing foreign keys without owning credentials or sessions.
 */
export async function ensureApplicationUser(identity: NeonIdentity) {
  const [emailOwner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1);

  if (emailOwner && emailOwner.id !== identity.id) {
    throw new IdentityProjectionConflictError();
  }

  const [user] = await db
    .insert(users)
    .values({
      id: identity.id,
      name: identity.name,
      email: identity.email,
      emailVerified: identity.emailVerified,
      image: identity.image ?? null,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        name: identity.name,
        email: identity.email,
        emailVerified: identity.emailVerified,
        image: identity.image ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });

  return user;
}
