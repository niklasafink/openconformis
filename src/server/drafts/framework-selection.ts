import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { appendAuditEvent } from "@/server/audit/event";
import { getSelectableFramework } from "@/server/catalogue/service";
import { db, isDatabaseConfigured } from "@/server/db/client";
import { anonymousDrafts } from "@/server/db/schema/application";

const draftBindingCookie = "conformis_draft_binding";
const draftLifetimeMilliseconds = 24 * 60 * 60 * 1000;

function hashBinding(binding: string) {
  return createHash("sha256").update(binding, "utf8").digest("hex");
}

function createBinding() {
  return randomBytes(32).toString("base64url");
}

export type PersistedFrameworkSelection = {
  draftId?: string;
  frameworkId: string;
  persisted: boolean;
};

export type BoundActiveDraft = {
  id: string;
  frameworkSlug: string | null;
  locale: string;
  expiresAt: Date;
};

export async function getBoundActiveDraft(
  expectedDraftId?: string,
): Promise<BoundActiveDraft | null> {
  if (!isDatabaseConfigured) return null;

  const cookieStore = await cookies();
  const binding = cookieStore.get(draftBindingCookie)?.value;

  if (!binding) return null;

  const filters = [
    eq(anonymousDrafts.bindingHash, hashBinding(binding)),
    eq(anonymousDrafts.status, "active"),
    gt(anonymousDrafts.expiresAt, new Date()),
  ];

  if (expectedDraftId) filters.push(eq(anonymousDrafts.id, expectedDraftId));

  const [draft] = await db
    .select({
      id: anonymousDrafts.id,
      frameworkSlug: anonymousDrafts.frameworkSlug,
      locale: anonymousDrafts.locale,
      expiresAt: anonymousDrafts.expiresAt,
    })
    .from(anonymousDrafts)
    .where(and(...filters))
    .limit(1);

  return draft ?? null;
}

export async function persistFrameworkSelection(
  frameworkId: string,
  locale: "de" | "en",
): Promise<PersistedFrameworkSelection> {
  const framework = await getSelectableFramework(frameworkId, locale);

  if (!framework) {
    throw new Error("The selected framework is unavailable.");
  }

  if (!isDatabaseConfigured) {
    return {
      frameworkId: framework.id,
      persisted: false,
    };
  }

  const cookieStore = await cookies();
  const currentBinding = cookieStore.get(draftBindingCookie)?.value;
  const now = new Date();

  if (currentBinding) {
    const existingDraft = await getBoundActiveDraft();

    if (existingDraft) {
      await db.transaction(async (transaction) => {
        await transaction
          .update(anonymousDrafts)
          .set({
            frameworkSlug: framework.id,
            locale,
            revision: sql`${anonymousDrafts.revision} + 1`,
            updatedAt: now,
          })
          .where(eq(anonymousDrafts.id, existingDraft.id));

        await appendAuditEvent(transaction, {
          anonymousDraftId: existingDraft.id,
          action: "draft.framework_selected",
          targetType: "anonymous_draft",
          targetId: existingDraft.id,
          metadata: {
            frameworkSlug: framework.id,
            locale,
          },
        });
      });

      return {
        draftId: existingDraft.id,
        frameworkId: framework.id,
        persisted: true,
      };
    }
  }

  const binding = createBinding();
  const bindingHash = hashBinding(binding);
  const expiresAt = new Date(now.getTime() + draftLifetimeMilliseconds);

  const draftId = await db.transaction(async (transaction) => {
    const [draft] = await transaction
      .insert(anonymousDrafts)
      .values({
        bindingHash,
        frameworkSlug: framework.id,
        locale,
        expiresAt,
      })
      .returning({ id: anonymousDrafts.id });

    if (!draft) {
      throw new Error("The analysis draft could not be created.");
    }

    await appendAuditEvent(transaction, {
      anonymousDraftId: draft.id,
      action: "draft.created",
      targetType: "anonymous_draft",
      targetId: draft.id,
      metadata: {
        frameworkSlug: framework.id,
        locale,
      },
    });

    return draft.id;
  });

  cookieStore.set(draftBindingCookie, binding, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    priority: "high",
  });

  return {
    draftId,
    frameworkId: framework.id,
    persisted: true,
  };
}
