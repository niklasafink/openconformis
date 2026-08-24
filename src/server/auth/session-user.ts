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

const localEvaluationUser: AuthenticatedSessionUser = {
  id: "local-evaluation-user",
  sessionId: "local-evaluation-session",
  name: "Local Evaluation",
  email: "local-evaluation@openconformis.invalid",
  emailVerified: true,
};

function isLocalAuthBypassEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.LOCAL_AUTH_BYPASS === "true";
}

export async function requireAuthenticatedSessionUser(): Promise<AuthenticatedSessionUser> {
  if (isLocalAuthBypassEnabled()) {
    await ensureApplicationUser({
      id: localEvaluationUser.id,
      name: localEvaluationUser.name,
      email: localEvaluationUser.email,
      emailVerified: localEvaluationUser.emailVerified,
      image: null,
    });
    return localEvaluationUser;
  }

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
