import "server-only";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/server/db/client";
import { documentBlocks, policies, policyVersions } from "@/server/db/schema/documents";
import { rateLimitWindows } from "@/server/db/schema/jobs";
import { createS3PrivateObjectStore } from "@/server/storage/s3-private-object-store";

const cleanupBatchSize = 25;

export async function purgeExpiredPolicyData() {
  const now = new Date();
  const store = createS3PrivateObjectStore();
  const originals = await db
    .select({
      id: policyVersions.id,
      objectKey: policyVersions.objectKey,
    })
    .from(policyVersions)
    .where(
      and(isNull(policyVersions.originalDeletedAt), lt(policyVersions.originalDeleteAfter, now)),
    )
    .limit(cleanupBatchSize);

  let originalObjectsDeleted = 0;
  for (const version of originals) {
    await store.deleteObject(version.objectKey);
    const [deleted] = await db
      .update(policyVersions)
      .set({ originalDeletedAt: now })
      .where(and(eq(policyVersions.id, version.id), isNull(policyVersions.originalDeletedAt)))
      .returning({ id: policyVersions.id });
    if (deleted) originalObjectsDeleted += 1;
  }

  const parsed = await db
    .select({
      id: policyVersions.id,
      policyId: policyVersions.policyId,
      processedObjectKey: policyVersions.processedObjectKey,
    })
    .from(policyVersions)
    .where(
      and(
        isNull(policyVersions.parsedDeletedAt),
        or(
          lt(policyVersions.parsedDeleteAfter, now),
          sql`${policyVersions.deletionRequestedAt} IS NOT NULL`,
        ),
        sql`NOT EXISTS (SELECT 1 FROM analyses WHERE analyses.policy_version_id = ${policyVersions.id})`,
      ),
    )
    .limit(cleanupBatchSize);

  let parsedPoliciesDeleted = 0;
  for (const version of parsed) {
    if (version.processedObjectKey) await store.deleteObject(version.processedObjectKey);
    await db.transaction(async (transaction) => {
      await transaction
        .delete(documentBlocks)
        .where(eq(documentBlocks.policyVersionId, version.id));
      await transaction
        .update(policyVersions)
        .set({ parseStatus: "deleted", parsedDeletedAt: now, deletedAt: now })
        .where(eq(policyVersions.id, version.id));
      await transaction
        .update(policies)
        .set({ lifecycleStatus: "deleted", deletedAt: now, updatedAt: now })
        .where(eq(policies.id, version.policyId));
    });
    parsedPoliciesDeleted += 1;
  }

  await db.delete(rateLimitWindows).where(lt(rateLimitWindows.expiresAt, now));
  return { originalObjectsDeleted, parsedPoliciesDeleted };
}
