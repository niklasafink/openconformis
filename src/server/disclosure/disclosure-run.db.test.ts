// @vitest-environment node

/**
 * Plausicheck-Läufe gegen eine **echte** PostgreSQL-Datenbank: Idempotenz des Starts,
 * Stoppen, Einordnung mit Replay und Schlüssellöschung hängen an SQL-Bedingungen, die
 * ein Mock nicht abbildet.
 *
 * Läuft nur mit `DISCLOSURE_TEST_DATABASE_URL` auf einer **Wegwerf-Datenbank** mit
 * angewendeten Migrationen; ohne die Variable werden die Tests übersprungen. Eine
 * Adresse, die nach einem gehosteten Dienst aussieht, wird abgelehnt.
 *
 *   DISCLOSURE_TEST_DATABASE_URL=postgresql://conformis:conformis@127.0.0.1:5432/conformis_e2e \
 *     pnpm exec vitest run src/server/disclosure/disclosure-run.db.test.ts
 *
 * Kein Aufruf geht an einen Anbieter: Modellaufruf, Schlüssel und Workflow-Start sind ersetzt.
 */

import { randomUUID } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDatabaseUrl = process.env.DISCLOSURE_TEST_DATABASE_URL ?? "";
const enabled =
  testDatabaseUrl.length > 0 && !/neon\.tech|amazonaws\.com|vercel/iu.test(testDatabaseUrl);
if (testDatabaseUrl && !enabled) {
  throw new Error(
    "DISCLOSURE_TEST_DATABASE_URL looks like a hosted database; use a throwaway one.",
  );
}
if (enabled) process.env.DATABASE_URL = testDatabaseUrl;

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  launch: vi.fn(),
  model: vi.fn(),
  deleteCredentials: vi.fn(),
  cancelRun: vi.fn(),
}));

vi.mock("./actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actor")>()),
  resolveDisclosureActor: mocks.actor,
}));
vi.mock("@/server/workflows/launch", () => ({
  launchDisclosurePlausibilityWorkflow: mocks.launch,
  launchDisclosureRecognitionWorkflow: vi.fn(),
}));
vi.mock("./model-route", () => ({ requestStructuredForDisclosure: mocks.model }));
vi.mock("@/server/ai/credential-cleanup", () => ({
  deleteTemporaryCredentialsForBinding: mocks.deleteCredentials,
  deleteTemporaryCredential: vi.fn(async () => undefined),
}));
vi.mock("@/server/storage/object-store", () => ({
  createPrivateObjectStore: () => ({
    getObjectBytes: async () => {
      throw new Error("ORIGINAL_DELETED");
    },
  }),
}));
vi.mock("workflow/api", () => ({
  getRun: () => ({ cancel: mocks.cancelRun }),
  start: vi.fn(),
}));

type Db = typeof import("@/server/db/client").db;

const suite = enabled ? describe : describe.skip;

suite("disclosure plausibility runs against a real database", () => {
  let db: Db;
  let eq: typeof import("drizzle-orm").eq;
  let schema: typeof import("@/server/db/schema/disclosure");
  let documents: typeof import("@/server/db/schema/documents");
  let start: typeof import("./start-run");
  let execute: typeof import("./execute-run");
  let assign: typeof import("./assign-run");
  let cancel: typeof import("./cancel-run");

  const suffix = randomUUID().slice(0, 8);
  const userId = `user-${suffix}`;
  const organizationId = `org-${suffix}`;
  let caseId = "";

  const frozenModel = {
    routeProvider: "openrouter",
    providerModelId: "test/model",
    modelProfileId: "openrouter:test/model",
    modelCatalogueVersion: "catalogue-1",
    promptVersion: "disclosure-assignment-v1",
  };
  const discard = vi.fn(async () => undefined);
  const prepareModel = vi.fn(async () => ({
    model: frozenModel,
    credentialId: randomUUID(),
    deadline: new Date(Date.now() + 3_600_000),
    discard,
  }));

  async function seedCase() {
    const authSchema = await import("@/server/db/schema/auth");
    await db.insert(authSchema.users).values({
      id: userId,
      name: "Disclosure Tester",
      email: `${userId}@example.invalid`,
      emailVerified: true,
    });
    await db.insert(authSchema.organizations).values({
      id: organizationId,
      name: "Test",
      slug: organizationId,
      createdAt: new Date(),
    });
    await db.insert(authSchema.members).values({
      id: `member-${suffix}`,
      organizationId,
      userId,
      role: "owner",
      createdAt: new Date(),
    });
    const [policy] = await db
      .insert(documents.policies)
      .values({ organizationId, ownerUserId: userId, displayName: "Bericht" })
      .returning({ id: documents.policies.id });
    const [version] = await db
      .insert(documents.policyVersions)
      .values({
        policyId: policy!.id,
        organizationId,
        versionNumber: 1,
        source: "upload",
        originalFilename: `bericht-${suffix}.docx`,
        sha256: suffix.padEnd(64, "c"),
        storageDriver: "vercel-blob",
        objectKey: `test/${suffix}/${randomUUID()}`,
        parserVersion: "test-parser",
        parseStatus: "parsing",
        originalDeleteAfter: new Date(Date.now() + 86_400_000),
        parsedDeleteAfter: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: documents.policyVersions.id });
    const blocks: Array<{
      text: string;
      type: "paragraph" | "table_cell";
      cell?: [number, number];
    }> = [
      { text: "Jahresabschluss zum 31. Dezember 2021", type: "paragraph" },
      { text: "31.12.2021 TEUR", type: "table_cell", cell: [0, 1] },
      { text: "31.12.2020 TEUR", type: "table_cell", cell: [0, 2] },
      { text: "Forderungen gegen Beteiligungsunternehmen", type: "table_cell", cell: [1, 0] },
      { text: "53,6", type: "table_cell", cell: [1, 1] },
      { text: "110,3", type: "table_cell", cell: [1, 2] },
      { text: "Bilanzsumme", type: "table_cell", cell: [2, 0] },
      { text: "6.828,2", type: "table_cell", cell: [2, 1] },
      { text: "10.268,8", type: "table_cell", cell: [2, 2] },
      {
        text: "Die Forderungen gegen Beteiligungsunternehmen von TEUR 54 (Vorjahr TEUR 110) betreffen die apoBank.",
        type: "paragraph",
      },
      {
        text: "Die Bilanzsumme ist im Berichtsjahr um 3.441 TEUR auf 6.828 TEUR gesunken.",
        type: "paragraph",
      },
    ];
    const inserted = await db
      .insert(documents.documentBlocks)
      .values(
        blocks.map((block, index) => ({
          policyVersionId: version!.id,
          blockKey: `b${index + 1}`,
          ordinal: index + 1,
          blockType: block.type,
          canonicalText: block.text,
          pageNumber: 1,
          tokenCount: 10,
          textHash: `${index + 1}`.padEnd(64, "d"),
        })),
      )
      .returning({ id: documents.documentBlocks.id, ordinal: documents.documentBlocks.ordinal });
    await db
      .update(documents.policyVersions)
      .set({
        parseStatus: "ready",
        detectedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: 1_000,
        pageCount: 1,
        authoritativeLanguage: "de",
        readyAt: new Date(),
      })
      .where(eq(documents.policyVersions.id, version!.id));
    const [created] = await db
      .insert(schema.disclosureCases)
      .values({ organizationId, ownerUserId: userId, title: "Testbericht" })
      .returning({ id: schema.disclosureCases.id });
    const [caseDocument] = await db
      .insert(schema.disclosureCaseDocuments)
      .values({
        caseId: created!.id,
        role: "report",
        policyVersionId: version!.id,
        ordinal: 0,
        displayName: "bericht.docx",
      })
      .returning({ id: schema.disclosureCaseDocuments.id });
    // Die Tabellenlage einer früheren Erkennung; ohne Original übernimmt die Erkennung sie.
    await db.insert(schema.disclosureBlockContext).values(
      inserted.flatMap((block) => {
        const cell = blocks[block.ordinal - 1]!.cell;
        return cell
          ? [
              {
                caseDocumentId: caseDocument!.id,
                documentBlockId: block.id,
                tableIndex: 0,
                rowIndex: cell[0],
                columnIndex: cell[1],
                isHeader: cell[0] === 0,
              },
            ]
          : [];
      }),
    );
    const { recognizeCaseDocument } = await import("./recognize");
    await recognizeCaseDocument(caseDocument!.id);
    return created!.id;
  }

  beforeAll(async () => {
    ({ db } = await import("@/server/db/client"));
    ({ eq } = await import("drizzle-orm"));
    schema = await import("@/server/db/schema/disclosure");
    documents = await import("@/server/db/schema/documents");
    start = await import("./start-run");
    execute = await import("./execute-run");
    assign = await import("./assign-run");
    cancel = await import("./cancel-run");
    mocks.actor.mockImplementation(async () => ({
      userId,
      emailVerified: true,
      organizationId,
      roles: ["owner"],
    }));
    caseId = await seedCase();
  });

  beforeEach(() => {
    mocks.launch.mockReset().mockResolvedValue({ runId: "wf" });
    mocks.deleteCredentials.mockReset().mockResolvedValue(0);
    mocks.model.mockReset();
    prepareModel.mockClear();
    discard.mockClear();
  });

  async function closeOpenRuns() {
    const { inArray } = await import("drizzle-orm");
    await db
      .update(schema.disclosureRuns)
      .set({ status: "cancelled" })
      .where(inArray(schema.disclosureRuns.status, ["queued", "running"]));
  }

  it("legt bei gleichzeitigen Starts mit denselben Eingaben genau einen Lauf an", async () => {
    await closeOpenRuns();
    const results = await Promise.all([
      start.startDisclosureRun(caseId, {}),
      start.startDisclosureRun(caseId, {}),
      start.startDisclosureRun(caseId, {}),
    ]);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    expect(results.filter((result) => !result.reused)).toHaveLength(1);
    expect(mocks.launch).toHaveBeenCalledWith(results[0]!.runId);
  });

  it("verweigert einen zweiten Start mit anderem Modell, solange ein Lauf offen ist", async () => {
    await closeOpenRuns();
    await start.startDisclosureRun(caseId, {});
    await expect(
      start.startDisclosureRun(
        caseId,
        { modelProfileId: frozenModel.modelProfileId },
        { prepareModel },
      ),
    ).rejects.toMatchObject({ code: "DISCLOSURE_RUN_IN_PROGRESS" });
    // Der schon abgeleitete Schlüssel des verworfenen Starts wird sofort gelöscht.
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("stoppt einen Lauf, löscht seinen Schlüssel und erlaubt danach einen neuen Start", async () => {
    await closeOpenRuns();
    const first = await start.startDisclosureRun(
      caseId,
      { modelProfileId: frozenModel.modelProfileId },
      { prepareModel },
    );
    const again = await start.startDisclosureRun(
      caseId,
      { modelProfileId: frozenModel.modelProfileId },
      { prepareModel },
    );
    expect(again).toMatchObject({ runId: first.runId, reused: true });
    const stopped = await cancel.cancelDisclosureRun(first.runId);
    expect(stopped).toMatchObject({ ok: true, status: "cancelled", changed: true });
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "disclosure", bindingId: first.runId }),
    );
    expect(await cancel.cancelDisclosureRun(first.runId)).toMatchObject({ changed: false });
    const next = await start.startDisclosureRun(caseId, {});
    expect(next.reused).toBe(false);
    expect(next.runId).not.toBe(first.runId);
  });

  it("ordnet über das Modell ein, liest Antworten beim Replay und löscht den Schlüssel im Abschluss", async () => {
    await closeOpenRuns();
    const run = await start.startDisclosureRun(
      caseId,
      { modelProfileId: frozenModel.modelProfileId },
      { prepareModel },
    );
    expect(await execute.prepareDisclosureRun(run.runId, `wf-${run.runId}`)).toEqual({
      status: "running",
      model: true,
    });
    expect(await execute.prepareDisclosureRun(run.runId, `other-${run.runId}`)).toEqual({
      status: "duplicate",
    });
    const stage = await execute.runDeterministicStage(run.runId);
    expect(stage.pending).toBeGreaterThan(0);
    const { batches } = await assign.planDisclosureAssignment(run.runId);
    expect(batches).toBe(1);
    mocks.model.mockImplementation(async (_run: unknown, request: { user: string }) => {
      expect(request.user).toContain("⟦54⟧");
      return {
        output: {
          assignments: [
            {
              ref: "F1",
              candidate: "1",
              period: "current",
              confidencePercent: 92,
              comment: "Bestand.",
            },
          ],
        },
        inputTokens: 500,
        outputTokens: 40,
        costMicrounits: 100,
      };
    });
    const first = await assign.assignDisclosureBatch(run.runId, 0);
    const replay = await assign.assignDisclosureBatch(run.runId, 0);
    expect(first.stored).toBeGreaterThan(0);
    expect(replay.stored).toBe(first.stored);
    expect(mocks.model).toHaveBeenCalledTimes(1);

    const checks = await db
      .select()
      .from(schema.disclosureChecks)
      .where(eq(schema.disclosureChecks.runId, run.runId));
    const modelCheck = checks.find((check) => check.assignmentSource === "model")!;
    expect(modelCheck).toMatchObject({ status: "match", rounded: true, confidenceBp: 9_200 });
    expect(
      checks.some((check) => check.kind === "sentence_arithmetic" && check.status === "match"),
    ).toBe(true);

    const finished = await execute.finalizeDisclosureRun(run.runId);
    expect(finished.status).toBe("completed");
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "disclosure", bindingId: run.runId }),
    );
    const [invocation] = await db
      .select()
      .from(schema.disclosureModelInvocations)
      .where(eq(schema.disclosureModelInvocations.runId, run.runId));
    expect(invocation).toMatchObject({ status: "succeeded", itemCount: 2, inputTokens: 500 });
    // Die gespeicherte Antwort enthält Kurzzeichen, keinen Berichtstext und keinen Schlüssel.
    expect(JSON.stringify(invocation!.response)).not.toMatch(/Beteiligungsunternehmen|apoBank/u);
  });
});
