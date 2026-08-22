import "server-only";

import { and, eq, isNull, lte } from "drizzle-orm";

import { db } from "@/server/db/client";
import { policyVersions } from "@/server/db/schema/documents";
import { createPrivateObjectStore } from "@/server/storage/object-store";

export async function getPolicyOriginalRetentionState(policyVersionId: string) {
  const [version] = await db
    .select({
      deleteAfter: policyVersions.originalDeleteAfter,
      deletedAt: policyVersions.originalDeletedAt,
    })
    .from(policyVersions)
    .where(eq(policyVersions.id, policyVersionId))
    .limit(1);
  if (!version || version.deletedAt) return { deleted: true as const };
  return { deleted: false as const, deleteAfter: version.deleteAfter.toISOString() };
}

export async function deletePolicyOriginalIfDue(policyVersionId: string) {
  const [version] = await db
    .select({ objectKey: policyVersions.objectKey })
    .from(policyVersions)
    .where(
      and(
        eq(policyVersions.id, policyVersionId),
        isNull(policyVersions.originalDeletedAt),
        lte(policyVersions.originalDeleteAfter, new Date()),
      ),
    )
    .limit(1);
  if (!version) return { deleted: false as const };

  await createPrivateObjectStore().deleteObject(version.objectKey);
  const [deleted] = await db
    .update(policyVersions)
    .set({ originalDeletedAt: new Date() })
    .where(and(eq(policyVersions.id, policyVersionId), isNull(policyVersions.originalDeletedAt)))
    .returning({ id: policyVersions.id });
  return { deleted: Boolean(deleted) };
}
