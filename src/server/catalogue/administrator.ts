import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import {
  AuthorizationDeniedError,
  requireAnyRole,
  requireSessionPrincipal,
} from "@/server/auth/session-principal";
import { db } from "@/server/db/client";
import { catalogueAdministrators } from "@/server/db/schema/catalogue";

import { isBootstrapCatalogueAdministrator } from "./administrator-policy";

export async function requireCatalogueAdministrator() {
  const principal = await requireSessionPrincipal();
  const [assignment] = await db
    .select({ id: catalogueAdministrators.id })
    .from(catalogueAdministrators)
    .where(
      and(
        eq(catalogueAdministrators.userId, principal.userId),
        isNull(catalogueAdministrators.revokedAt),
      ),
    )
    .limit(1);

  if (assignment) return principal;

  if (isBootstrapCatalogueAdministrator(principal, process.env.CATALOGUE_ADMIN_EMAILS)) {
    return requireAnyRole(principal, ["owner", "admin"]);
  }

  throw new AuthorizationDeniedError();
}

/**
 * Nicht werfende Variante für die Sidebar: der Administration-Eintrag darf nur
 * für berechtigte Nutzer erscheinen, sonst führt er für alle anderen in einen
 * 404 statt gar nicht erst sichtbar zu sein.
 */
export async function isCatalogueAdministrator(): Promise<boolean> {
  return requireCatalogueAdministrator()
    .then(() => true)
    .catch(() => false);
}
