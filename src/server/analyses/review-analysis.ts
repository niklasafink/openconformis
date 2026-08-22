import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { appendAuditEvent } from "@/server/audit/event";
import {
  requireAnyRole,
  requireSessionPrincipal,
  type SessionPrincipal,
} from "@/server/auth/session-principal";
import { VerifiedEmailRequiredError } from "@/server/auth/session-user";
import { db } from "@/server/db/client";
import {
  analyses,
  analysisRequirementResults,
  analysisResultOverrides,
  analysisScopeItems,
} from "@/server/db/schema/analyses";

const confirmationRoles = ["owner", "admin", "reviewer"] as const;
const overrideRoles = ["owner", "admin", "analyst", "reviewer"] as const;

export type ReviewResultStatus =
  | "fulfilled"
  | "partially_fulfilled"
  | "not_fulfilled"
  | "not_applicable"
  | "no_assessment_possible";

export class AnalysisResultNotFoundError extends Error {
  constructor() {
    super("The analysis result was not found in the active organization.");
    this.name = "AnalysisResultNotFoundError";
  }
}

export class AnalysisNotCompletedError extends Error {
  constructor() {
    super("Only completed analyses can be reviewed.");
    this.name = "AnalysisNotCompletedError";
  }
}

export function requireAssessmentConfirmationPermission(principal: SessionPrincipal) {
  if (!principal.emailVerified) throw new VerifiedEmailRequiredError();
  return requireAnyRole(principal, confirmationRoles);
}

export function requireAssessmentOverridePermission(principal: SessionPrincipal) {
  if (!principal.emailVerified) throw new VerifiedEmailRequiredError();
  return requireAnyRole(principal, overrideRoles);
}

export async function setAnalysisResultOverride(input: {
  analysisId: string;
  resultId: string;
  status: ReviewResultStatus;
  reason: string;
}) {
  const principal = requireAssessmentOverridePermission(await requireSessionPrincipal());
  const reason = input.reason.trim();

  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({
        id: analysisRequirementResults.id,
        analysisStatus: analyses.status,
        regulatoryId: analysisScopeItems.regulatoryId,
      })
      .from(analysisRequirementResults)
      .innerJoin(analyses, eq(analyses.id, analysisRequirementResults.analysisId))
      .innerJoin(
        analysisScopeItems,
        eq(analysisScopeItems.id, analysisRequirementResults.scopeItemId),
      )
      .where(
        and(
          eq(analysisRequirementResults.id, input.resultId),
          eq(analysisRequirementResults.analysisId, input.analysisId),
          eq(analyses.organizationId, principal.organizationId),
        ),
      )
      .limit(1);

    if (!target) throw new AnalysisResultNotFoundError();
    if (target.analysisStatus !== "completed") throw new AnalysisNotCompletedError();

    await transaction.execute(
      sql`select ${analysisRequirementResults.id}
          from ${analysisRequirementResults}
          where ${analysisRequirementResults.id} = ${target.id}
          for update`,
    );

    const changedAt = new Date();
    const [override] = await transaction
      .insert(analysisResultOverrides)
      .values({
        resultId: target.id,
        status: input.status,
        reason,
        actorUserId: principal.userId,
        createdAt: changedAt,
      })
      .returning({
        id: analysisResultOverrides.id,
        status: analysisResultOverrides.status,
        reason: analysisResultOverrides.reason,
        createdAt: analysisResultOverrides.createdAt,
      });
    if (!override) throw new AnalysisResultNotFoundError();

    await transaction
      .update(analysisRequirementResults)
      .set({ confirmedByUserId: null, confirmedAt: null, updatedAt: changedAt })
      .where(eq(analysisRequirementResults.id, target.id));

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "analysis_result.overridden",
      targetType: "analysis_requirement_result",
      targetId: target.id,
      metadata: {
        analysisId: input.analysisId,
        regulatoryId: target.regulatoryId,
        status: input.status,
        confirmationInvalidated: true,
      },
    });

    return { ...override, confirmationInvalidated: true };
  });
}

export async function setAnalysisResultConfirmation(input: {
  analysisId: string;
  resultId: string;
  confirmed: boolean;
}) {
  const principal = requireAssessmentConfirmationPermission(await requireSessionPrincipal());

  return db.transaction(async (transaction) => {
    const [target] = await transaction
      .select({
        id: analysisRequirementResults.id,
        analysisStatus: analyses.status,
        regulatoryId: analysisScopeItems.regulatoryId,
      })
      .from(analysisRequirementResults)
      .innerJoin(analyses, eq(analyses.id, analysisRequirementResults.analysisId))
      .innerJoin(
        analysisScopeItems,
        eq(analysisScopeItems.id, analysisRequirementResults.scopeItemId),
      )
      .where(
        and(
          eq(analysisRequirementResults.id, input.resultId),
          eq(analysisRequirementResults.analysisId, input.analysisId),
          eq(analyses.organizationId, principal.organizationId),
        ),
      )
      .limit(1);

    if (!target) throw new AnalysisResultNotFoundError();
    if (target.analysisStatus !== "completed") throw new AnalysisNotCompletedError();

    await transaction.execute(
      sql`select ${analysisRequirementResults.id}
          from ${analysisRequirementResults}
          where ${analysisRequirementResults.id} = ${target.id}
          for update`,
    );
    const [current] = await transaction
      .select({ confirmedAt: analysisRequirementResults.confirmedAt })
      .from(analysisRequirementResults)
      .where(eq(analysisRequirementResults.id, target.id))
      .limit(1);
    if (!current) throw new AnalysisResultNotFoundError();

    const isConfirmed = current.confirmedAt !== null;
    if (isConfirmed === input.confirmed) {
      return { confirmed: isConfirmed, confirmedAt: current.confirmedAt };
    }

    const changedAt = new Date();
    const [updated] = await transaction
      .update(analysisRequirementResults)
      .set({
        confirmedByUserId: input.confirmed ? principal.userId : null,
        confirmedAt: input.confirmed ? changedAt : null,
        updatedAt: changedAt,
      })
      .where(eq(analysisRequirementResults.id, target.id))
      .returning({ confirmedAt: analysisRequirementResults.confirmedAt });

    if (!updated) throw new AnalysisResultNotFoundError();

    await appendAuditEvent(transaction, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: input.confirmed ? "analysis_result.confirmed" : "analysis_result.unconfirmed",
      targetType: "analysis_requirement_result",
      targetId: target.id,
      metadata: {
        analysisId: input.analysisId,
        regulatoryId: target.regulatoryId,
        confirmed: input.confirmed,
      },
    });

    return { confirmed: input.confirmed, confirmedAt: updated.confirmedAt };
  });
}

export function canConfirmAssessment(principal: Pick<SessionPrincipal, "emailVerified" | "roles">) {
  return (
    principal.emailVerified &&
    principal.roles.some((role) =>
      confirmationRoles.includes(role as (typeof confirmationRoles)[number]),
    )
  );
}

export function canOverrideAssessment(
  principal: Pick<SessionPrincipal, "emailVerified" | "roles">,
) {
  return (
    principal.emailVerified &&
    principal.roles.some((role) => overrideRoles.includes(role as (typeof overrideRoles)[number]))
  );
}
