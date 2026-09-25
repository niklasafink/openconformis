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
  jev: vi.fn(),
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
vi.mock("./jev-route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jev-route")>()),
  requestJevForBatch: mocks.jev,
}));
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
  let review: typeof import("./finding-review");

  const suffix = randomUUID().slice(0, 8);
  const userId = `user-${suffix}`;
  const managerId = `manager-${suffix}`;
  const viewerId = `viewer-${suffix}`;
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
    // Zweite und dritte Person derselben Organisation: Manager und nur lesend.
    for (const [id, role] of [
      [managerId, "admin"],
      [viewerId, "viewer"],
    ] as const) {
      await db.insert(authSchema.users).values({
        id,
        name: role === "admin" ? "Maria Manager" : "Viktor Viewer",
        email: `${id}@example.invalid`,
        emailVerified: true,
      });
      await db.insert(authSchema.members).values({
        id: `member-${id}`,
        organizationId,
        userId: id,
        role,
        createdAt: new Date(),
      });
    }
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
      // Eine falsche Satzrechnung wie gbs Tz 66: von 110 auf 54 sind 56, nicht 50.
      {
        text: "Die Wertberichtigungen sanken von TEUR 110 um TEUR 50 auf TEUR 54.",
        type: "paragraph",
      },
      // Die Richtungslüge wie gbs Tz 62: sie ist auf jedem Einordnungsweg rot.
      {
        text: "Die Bilanzsumme erhöhte sich im Berichtsjahr um 3.441 TEUR auf 6.828 TEUR.",
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
    review = await import("./finding-review");
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
    mocks.jev.mockReset();
    prepareModel.mockClear();
    discard.mockClear();
  });

  async function closeOpenRuns() {
    const { and, inArray } = await import("drizzle-orm");
    // Nur die eigene Prüfung: andere DB-Tests laufen parallel auf derselben Datenbank.
    await db
      .update(schema.disclosureRuns)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.disclosureRuns.caseId, caseId),
          inArray(schema.disclosureRuns.status, ["queued", "running"]),
        ),
      );
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
      jev: false,
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

  const modelAnswer = async () => ({
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
  });
  const jevDiscard = vi.fn(async () => undefined);
  const prepareJev = vi.fn(async () => ({
    modelId: "jev-latest",
    credentialId: randomUUID(),
    discard: jevDiscard,
  }));

  /** Ein ganzer Lauf ohne Workflow: dieselben Schritte in derselben Reihenfolge. */
  async function runThrough(options: { jev: boolean }) {
    await closeOpenRuns();
    const run = await start.startDisclosureRun(
      caseId,
      { modelProfileId: frozenModel.modelProfileId },
      { prepareModel, prepareJev: options.jev ? prepareJev : async () => null },
    );
    const prepared = await execute.prepareDisclosureRun(run.runId, `wf-${run.runId}`);
    expect(prepared).toMatchObject({ status: "running", jev: options.jev });
    await execute.runDeterministicStage(run.runId);
    if (prepared.status === "running" && prepared.jev) {
      const { batches } = await assign.planDisclosureJev(run.runId);
      for (let index = 0; index < batches; index += 1) {
        await assign.assignDisclosureJevBatch(run.runId, index);
      }
    }
    const { batches } = await assign.planDisclosureAssignment(run.runId);
    for (let index = 0; index < batches; index += 1) {
      await assign.assignDisclosureBatch(run.runId, index);
    }
    await execute.finalizeDisclosureRun(run.runId);
    const checks = await db
      .select()
      .from(schema.disclosureChecks)
      .where(eq(schema.disclosureChecks.runId, run.runId));
    const invocations = await db
      .select()
      .from(schema.disclosureModelInvocations)
      .where(eq(schema.disclosureModelInvocations.runId, run.runId));
    const [stored] = await db
      .select()
      .from(schema.disclosureRuns)
      .where(eq(schema.disclosureRuns.id, run.runId));
    return { runId: run.runId, checks, invocations, stored: stored!, modelBatches: batches };
  }

  const outcome = (checks: Array<{ kind: string; status: string; subjectKey: string }>) =>
    checks.map((check) => `${check.kind}|${check.subjectKey}|${check.status}`).sort();

  it("ordnet mit Jev zuerst ein, gibt nur Unsicheres ans Modell und löscht beide Schlüssel", async () => {
    mocks.model.mockImplementation(modelAnswer);
    const off = await runThrough({ jev: false });
    expect(off.stored).toMatchObject({ jevAssist: "off", assistCredentialId: null });
    expect(mocks.jev).not.toHaveBeenCalled();
    expect(off.invocations.every((row) => row.provider === "model")).toBe(true);

    mocks.model.mockClear();
    mocks.deleteCredentials.mockClear();
    // Jev ist sicher bei der ersten Fundstelle und unsicher bei der zweiten.
    mocks.jev.mockImplementation(async () => ({
      answers: new Map([
        [
          "F1",
          {
            line_item: { type: "choice", choice: "c1", confidence: 0.92, probabilities: {} },
            period: { type: "choice", choice: "current", confidence: 0.95, probabilities: {} },
          },
        ],
        [
          "F2",
          {
            line_item: { type: "choice", choice: "c1", confidence: 0.4, probabilities: {} },
            period: { type: "choice", choice: "prior", confidence: 0.9, probabilities: {} },
          },
        ],
      ]),
      inputTokens: 300,
      outputTokens: 8,
      failedItems: 0,
      lastErrorCode: null,
    }));
    const on = await runThrough({ jev: true });
    expect(on.stored).toMatchObject({ jevAssist: "on", jevModelId: "jev-latest" });
    expect(on.stored.configurationHash).not.toBe(off.stored.configurationHash);
    const jevRow = on.invocations.find((row) => row.provider === "jev")!;
    expect(jevRow).toMatchObject({ status: "succeeded", routeProvider: "typesafe", itemCount: 2 });
    // Nur die unsichere Fundstelle geht an das Nutzermodell.
    const modelRow = on.invocations.find((row) => row.provider === "model")!;
    expect(modelRow.itemCount).toBe(1);
    expect(on.checks.some((check) => check.assignmentSource === "jev")).toBe(true);
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "disclosure", bindingId: on.runId }),
    );
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "disclosure_assist", bindingId: on.runId }),
    );

    // Dasselbe Ergebnis-Schema auf beiden Wegen; die Richtungslüge ist auf beiden rot.
    const rules = (checks: typeof on.checks) =>
      outcome(checks.filter((check) => check.assignmentSource === "rule"));
    expect(rules(on.checks)).toEqual(rules(off.checks));
    for (const result of [on, off]) {
      expect(
        result.checks.some((check) => check.kind === "direction" && check.status === "mismatch"),
      ).toBe(true);
    }
    const jevCheck = on.checks.find((check) => check.assignmentSource === "jev")!;
    const offCheck = off.checks.find(
      (check) => check.assignmentSource === "model" && check.subjectKey === jevCheck.subjectKey,
    )!;
    expect({ status: jevCheck.status, rounded: jevCheck.rounded }).toEqual({
      status: offCheck.status,
      rounded: offCheck.rounded,
    });
  });

  it("gibt bei einem Jev-Ausfall alle Fundstellen an das Modell, ohne Jev zu wiederholen", async () => {
    mocks.model.mockImplementation(modelAnswer);
    mocks.jev.mockRejectedValue(
      Object.assign(new Error("PROVIDER_CREDENTIAL_INVALID"), {
        code: "PROVIDER_CREDENTIAL_INVALID",
      }),
    );
    const result = await runThrough({ jev: true });
    expect(result.stored.status).toBe("completed");
    const jevRow = result.invocations.find((row) => row.provider === "jev")!;
    expect(jevRow.status).toBe("failed");
    expect(result.invocations.find((row) => row.provider === "model")!.itemCount).toBe(2);
    await assign.assignDisclosureJevBatch(result.runId, 0);
    expect(mocks.jev).toHaveBeenCalledTimes(1);
  });

  it("löscht beim Stoppen den Modell- und den Jev-Schlüssel", async () => {
    await closeOpenRuns();
    const run = await start.startDisclosureRun(
      caseId,
      { modelProfileId: frozenModel.modelProfileId },
      { prepareModel, prepareJev },
    );
    await cancel.cancelDisclosureRun(run.runId);
    for (const purpose of ["disclosure", "disclosure_assist"]) {
      expect(mocks.deleteCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ purpose, bindingId: run.runId }),
      );
    }
  });

  const actAs = (id: string, roles: string[]) =>
    mocks.actor.mockImplementation(async () => ({
      userId: id,
      emailVerified: true,
      organizationId,
      roles,
    }));

  it("verlangt zwei verschiedene Personen, und eine Ablehnung ist genau ein Ereignis", async () => {
    mocks.model.mockImplementation(modelAnswer);
    const { runId } = await runThrough({ jev: false });
    const findings = await db
      .select()
      .from(schema.disclosureFindings)
      .innerJoin(
        schema.disclosureChecks,
        eq(schema.disclosureChecks.id, schema.disclosureFindings.checkId),
      )
      .where(eq(schema.disclosureFindings.runId, runId));
    const arithmetic = findings.find(
      ({ disclosure_checks: check }) =>
        check.kind === "sentence_arithmetic" && check.status === "mismatch",
    )!.disclosure_findings;
    const direction = findings.find(
      ({ disclosure_checks: check }) => check.kind === "direction" && check.status === "mismatch",
    )!.disclosure_findings;
    const eventsOf = (findingId: string) =>
      db
        .select()
        .from(schema.disclosureFindingEvents)
        .where(eq(schema.disclosureFindingEvents.findingId, findingId));

    try {
      // Nur lesend: weder übernehmen noch freigeben.
      actAs(viewerId, ["viewer"]);
      await expect(review.reviewFinding(arithmetic.id, { action: "accept" })).rejects.toMatchObject(
        { code: "DISCLOSURE_FORBIDDEN", status: 403 },
      );

      // Stufe 1: ein abweichender Wert braucht eine Begründung; Text ist kein Wert.
      actAs(userId, ["owner"]);
      await expect(
        review.reviewFinding(arithmetic.id, { action: "accept", value: "61" }),
      ).rejects.toMatchObject({ code: "DISCLOSURE_REASON_REQUIRED" });
      await expect(
        review.reviewFinding(arithmetic.id, {
          action: "accept",
          value: "sechzig",
          reason: "Wort",
        }),
      ).rejects.toMatchObject({ code: "DISCLOSURE_VALUE_INVALID" });
      expect(await review.reviewFinding(arithmetic.id, { action: "accept" })).toEqual({
        status: "prepared",
      });
      const [correction] = await db
        .select()
        .from(schema.disclosureFindingCorrections)
        .where(eq(schema.disclosureFindingCorrections.findingId, arithmetic.id));
      expect(correction).toMatchObject({ acceptedRawText: "56 TEUR", supersededAt: null });

      // Dieselbe Person darf nicht freigeben, auch als owner — und der Versuch steht im Audit.
      await expect(
        review.reviewFinding(arithmetic.id, { action: "release" }),
      ).rejects.toMatchObject({ code: "DISCLOSURE_SAME_PERSON", status: 403 });
      const [still] = await db
        .select()
        .from(schema.disclosureFindings)
        .where(eq(schema.disclosureFindings.id, arithmetic.id));
      expect(still).toMatchObject({ reviewStatus: "prepared", reviewedByUserId: null });
      const { auditEvents } = await import("@/server/db/schema/application");
      const { and } = await import("drizzle-orm");
      const denied = await db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.targetId, arithmetic.id),
            eq(auditEvents.action, "disclosure.finding_review_denied"),
          ),
        )
        .orderBy(auditEvents.createdAt);
      // Der Versuch des Lesers und der des Prüfers, je mit Person und Code.
      expect(denied.map((event) => [event.actorUserId, event.metadata])).toEqual([
        [viewerId, { attempted: "accept", code: "DISCLOSURE_FORBIDDEN" }],
        [userId, { attempted: "release", code: "DISCLOSURE_SAME_PERSON" }],
      ]);

      // Der Manager lehnt ab: genau ein Ereignis, kein Statuswechsel.
      actAs(managerId, ["admin"]);
      const before = (await eventsOf(arithmetic.id)).length;
      expect(
        await review.reviewFinding(arithmetic.id, { action: "reject", comment: "Bitte prüfen" }),
      ).toEqual({ status: "prepared" });
      const afterReject = await eventsOf(arithmetic.id);
      expect(afterReject).toHaveLength(before + 1);
      expect(afterReject.filter((event) => event.kind === "rejected")).toHaveLength(1);

      // Und gibt danach frei; eine zweite Freigabe ist nicht mehr möglich.
      expect(await review.reviewFinding(arithmetic.id, { action: "release" })).toEqual({
        status: "reviewed",
      });
      await expect(
        review.reviewFinding(arithmetic.id, { action: "release" }),
      ).rejects.toMatchObject({ code: "DISCLOSURE_FINDING_REVIEWED" });

      // Ein Richtungswort hat keinen Wert zum Übernehmen, nur Bestätigen mit Begründung.
      actAs(userId, ["owner"]);
      await expect(review.reviewFinding(direction.id, { action: "accept" })).rejects.toMatchObject({
        code: "DISCLOSURE_VALUE_NOT_AVAILABLE",
      });
      await review.reviewFinding(direction.id, { action: "confirm", reason: "Text bleibt so." });

      // Eine Erwähnung nur von Mitgliedern; die Leseseite zeigt den gesperrten Zustand.
      await review.reviewFinding(direction.id, {
        action: "comment",
        body: "@Maria Manager bitte ansehen",
        mentions: [managerId],
      });
      await expect(
        review.reviewFinding(direction.id, {
          action: "comment",
          body: "@Fremd",
          mentions: ["someone-else"],
        }),
      ).rejects.toMatchObject({ code: "DISCLOSURE_MENTION_INVALID" });
      const { reviews } = await review.readFindingReviews(runId);
      expect(reviews[direction.id]).toMatchObject({
        status: "prepared",
        release: "second_person_required",
      });
      expect(reviews[direction.id]!.history.at(-1)).toMatchObject({
        kind: "comment",
        mentions: [{ userId: managerId, name: "Maria Manager" }],
      });
      expect(reviews[arithmetic.id]).toMatchObject({
        status: "reviewed",
        release: "done",
        correction: { value: "56 TEUR" },
      });
      actAs(managerId, ["admin"]);
      expect((await review.readFindingReviews(runId)).reviews[direction.id]!.release).toBe(
        "allowed",
      );
    } finally {
      actAs(userId, ["owner"]);
    }
  });
});
