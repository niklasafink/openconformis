import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getRun } from "workflow/api";

import { appendAuditEvent } from "@/server/audit/event";
import { db } from "@/server/db/client";
import { disclosureRuns } from "@/server/db/schema/disclosure";

import { requirePreparer, resolveDisclosureActor } from "./actor";
import { deleteDisclosureRunCredentials, materializeFindings } from "./execute-run";

/**
 * „Analyse stoppen“: beendet einen wartenden oder laufenden Lauf wie die
 * Vertragsprüfung. Bereits gespeicherte Prüfungen bleiben sichtbar, beide kurzlebigen
 * Schlüssel (Modell und Jev) werden sofort gelöscht, und ein neuer Start ist danach
 * erlaubt.
 */
export async function cancelDisclosureRun(
  runId: string,
): Promise<
  { ok: true; status: string; changed: boolean } | { ok: false; code: "DISCLOSURE_RUN_NOT_FOUND" }
> {
  const actor = requirePreparer(await resolveDisclosureActor());
  if (!z.uuid().safeParse(runId).success) return { ok: false, code: "DISCLOSURE_RUN_NOT_FOUND" };

  const result = await db.transaction(async (transaction) => {
    const [run] = await transaction
      .select({
        id: disclosureRuns.id,
        caseId: disclosureRuns.caseId,
        status: disclosureRuns.status,
        organizationId: disclosureRuns.organizationId,
        ownerUserId: disclosureRuns.ownerUserId,
        routeProvider: disclosureRuns.routeProvider,
        assistCredentialId: disclosureRuns.assistCredentialId,
        workflowRunId: disclosureRuns.workflowRunId,
      })
      .from(disclosureRuns)
      .where(
        and(eq(disclosureRuns.id, runId), eq(disclosureRuns.organizationId, actor.organizationId)),
      )
      .limit(1);
    if (!run) return { run: undefined, changed: false };
    // Derselbe Lock wie beim Start: Stoppen und ein gleichzeitiger Start schließen sich aus.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`disclosure-run:${run.caseId}`}, 0))`,
    );
    if (run.status !== "queued" && run.status !== "running") return { run, changed: false };
    const [cancelled] = await transaction
      .update(disclosureRuns)
      .set({
        status: "cancelled",
        stage: "done",
        failureCode: "DISCLOSURE_RUN_CANCELLED",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(disclosureRuns.id, run.id), inArray(disclosureRuns.status, ["queued", "running"])),
      )
      .returning({ id: disclosureRuns.id });
    if (!cancelled) return { run, changed: false };
    await appendAuditEvent(transaction, {
      organizationId: run.organizationId,
      actorUserId: actor.userId,
      action: "disclosure.run_cancelled",
      targetType: "disclosure_run",
      targetId: run.id,
      metadata: { previousStatus: run.status },
    });
    return { run, changed: true };
  });

  if (!result.run) return { ok: false, code: "DISCLOSURE_RUN_NOT_FOUND" };
  if (result.changed) {
    await deleteDisclosureRunCredentials(result.run);
    await materializeFindings(result.run.id).catch(() => undefined);
    if (result.run.workflowRunId) {
      // Nur beschleunigend: auch ohne Abbruch endet jeder Schritt am Status.
      await getRun(result.run.workflowRunId)
        .cancel()
        .catch((error: unknown) => {
          console.error(
            "[disclosure-cancel] workflow run could not be cancelled",
            error instanceof Error ? error.name : typeof error,
          );
        });
    }
  }
  return {
    ok: true,
    status: result.changed ? "cancelled" : result.run.status,
    changed: result.changed,
  };
}
