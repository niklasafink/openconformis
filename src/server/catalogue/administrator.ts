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
