import type { SessionPrincipal } from "@/server/auth/principal-roles";

export function isBootstrapCatalogueAdministrator(
  principal: SessionPrincipal,
  configuredEmails: string | undefined,
) {
  if (!principal.emailVerified) return false;

  const allowedEmails = (configuredEmails ?? "")
    .split(",")
    .map((email) => email.trim().toLocaleLowerCase("en"))
    .filter(Boolean);

  return allowedEmails.includes(principal.email.trim().toLocaleLowerCase("en"));
}
