import "server-only";

import { and, eq, isNull, lt } from "drizzle-orm";

import { db } from "@/server/db/client";
import { disclosureEvidenceFiles } from "@/server/db/schema/disclosure";
import { createPrivateObjectStore } from "@/server/storage/object-store";

const cleanupBatchSize = 25;

/**
 * Rückfall für Belegdateien der Offenlegungspflicht: das Original wird normalerweise
 * direkt nach dem Lesen gelöscht. Ein abgebrochener oder nie abgeschlossener Upload
 * bliebe sonst im Blob liegen; nach `delete_after` räumt der tägliche Lauf ihn ab.
 * Die gelesenen Konten bleiben, sie sind kein Original.
 */
export async function purgeExpiredEvidenceOriginals() {
  const now = new Date();
  const expired = await db
    .select({ id: disclosureEvidenceFiles.id, objectKey: disclosureEvidenceFiles.objectKey })
    .from(disclosureEvidenceFiles)
    .where(
      and(
        isNull(disclosureEvidenceFiles.originalDeletedAt),
        lt(disclosureEvidenceFiles.deleteAfter, now),
      ),
    )
    .limit(cleanupBatchSize);

  let deleted = 0;
  const store = expired.length > 0 ? createPrivateObjectStore() : null;
  for (const file of expired) {
    await store!.deleteObject(file.objectKey);
    const [updated] = await db
      .update(disclosureEvidenceFiles)
      .set({ originalDeletedAt: now })
      .where(
        and(
          eq(disclosureEvidenceFiles.id, file.id),
          isNull(disclosureEvidenceFiles.originalDeletedAt),
        ),
      )
      .returning({ id: disclosureEvidenceFiles.id });
    if (updated) deleted += 1;
  }
  return { evidenceOriginalsDeleted: deleted };
}
