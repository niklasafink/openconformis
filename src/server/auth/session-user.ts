import "server-only";

import { auth, isAuthenticationConfigured } from "./index";
import { ensureApplicationUser } from "./identity-projection";
import { AuthenticationRequiredError } from "./session-principal";

export class VerifiedEmailRequiredError extends Error {
  constructor() {
    super("A verified email address is required.");
    this.name = "VerifiedEmailRequiredError";
  }
}

export type AuthenticatedSessionUser = {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

export async function requireAuthenticatedSessionUser(): Promise<AuthenticatedSessionUser> {
  if (!isAuthenticationConfigured) throw new AuthenticationRequiredError();

  const { data: session, error } = await auth.getSession();
  if (error || !session?.user || !session.session) throw new AuthenticationRequiredError();

  await ensureApplicationUser(session.user);

  return {
    id: session.user.id,
    sessionId: session.session.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  };
}

export async function requireVerifiedSessionUser() {
  const user = await requireAuthenticatedSessionUser();
  if (!user.emailVerified) throw new VerifiedEmailRequiredError();
  return { ...user, emailVerified: true as const };
}
