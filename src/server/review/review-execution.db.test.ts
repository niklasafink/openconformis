// @vitest-environment node

/**
 * Prüft die Vertragsprüfung gegen eine **echte** PostgreSQL-Datenbank: Idempotenz,
 * Zählung, Fortschritt, Abschluss, Abbruch und das Live-Delta hängen an SQL-Bedingungen,
 * die ein Mock nicht abbildet.
 *
 * Läuft nur mit `REVIEW_TEST_DATABASE_URL` auf einer **Wegwerf-Datenbank**, deren
 * Migrationen angewendet sind (`pnpm db:migrate:local` mit dieser URL). Ohne die
 * Variable werden die Tests übersprungen; deshalb bleibt `pnpm test` ohne Datenbank
 * grün. Eine Adresse, die nach einem gehosteten Dienst aussieht, wird abgelehnt — diese
 * Tests legen Zeilen an und löschen sie nicht wieder.
 *
 *   REVIEW_TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5599/db pnpm test review-execution
 *
 * Kein Aufruf geht an TypeSafe oder einen anderen Anbieter: `requestSystemOne`, das
 * grosse Modell und die Schlüsselentschlüsselung sind ersetzt.
 */

import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const testDatabaseUrl = process.env.REVIEW_TEST_DATABASE_URL ?? "";
const enabled =
  testDatabaseUrl.length > 0 && !/neon\.tech|amazonaws\.com|vercel/iu.test(testDatabaseUrl);
if (testDatabaseUrl && !enabled) {
  throw new Error("REVIEW_TEST_DATABASE_URL looks like a hosted database; use a throwaway one.");
}
if (enabled) process.env.DATABASE_URL = testDatabaseUrl;

const mocks = vi.hoisted(() => ({
  jev: vi.fn(),
  model: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
  deleteCredentials: vi.fn(),
  launch: vi.fn(),
  actor: vi.fn(),
  createCredential: vi.fn(),
  resolveModel: vi.fn(),
  runStatus: new Map<string, string>(),
}));

vi.mock("@/server/ai/typesafe", () => ({ requestSystemOne: mocks.jev }));
vi.mock("@/server/ai/jev-throttle", () => ({
  createJevThrottle: () => ({
    run: (_tokens: number, call: () => Promise<unknown>) => call(),
    penalize: () => undefined,
  }),
}));
vi.mock("./review-provider", () => ({
  withRoutingKey: async (_run: unknown, work: (apiKey: string) => Promise<unknown>) =>
    work("test-routing-key"),
  requestStructuredForReview: mocks.model,
  ReviewRouteError: class ReviewRouteError extends Error {},
}));
vi.mock("workflow/api", () => ({ getRun: mocks.getRun, start: vi.fn() }));
vi.mock("@/server/ai/credential-cleanup", () => ({
  deleteTemporaryCredentialsForBinding: mocks.deleteCredentials,
  deleteTemporaryCredential: vi.fn(async () => undefined),
}));
vi.mock("@/server/workflows/launch", () => ({ launchReviewWorkflow: mocks.launch }));
vi.mock("./review-actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./review-actor")>()),
  resolveReviewActor: mocks.actor,
}));
vi.mock("@/server/ai/temporary-credential-service", () => ({
  createReviewRunCredential: mocks.createCredential,
  TemporaryCredentialError: class TemporaryCredentialError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));
vi.mock("@/server/ai/model-catalogue", () => ({
  resolveAnalysisModelSelection: mocks.resolveModel,
}));

type Db = typeof import("@/server/db/client").db;
type Schema = typeof import("@/server/db/schema/reviews");

const suite = enabled ? describe : describe.skip;

suite("contract review execution against a real database", () => {
  let db: Db;
  let schema: Schema;
  let documentsSchema: typeof import("@/server/db/schema/documents");
  let authSchema: typeof import("@/server/db/schema/auth");
  let aiSchema: typeof import("@/server/db/schema/ai");
  let start: typeof import("./start-review");
  let childRun: typeof import("./execute-review-document");
  let parentRun: typeof import("./execute-review");
  let cells: typeof import("./review-cells");
  let read: typeof import("./read-review");
  let actions: typeof import("./review-actions");
  let cancel: typeof import("./cancel-review");
  let manage: typeof import("./manage-review-table");
  let xlsx: typeof import("@/server/exports/review-xlsx");
  let eq: typeof import("drizzle-orm").eq;

  const suffix = randomUUID().slice(0, 8);
  const userId = `user-${suffix}`;
  const organizationId = `org-${suffix}`;
  const versionIds: string[] = [];
  const contractTexts = [
    "Dieser Vertrag unterliegt deutschem Recht unter Ausschluss des UN-Kaufrechts.",
    "Jede Partei kann den Vertrag aus wichtigem Grund fristlos kündigen.",
    "Die Gesamthaftung des Anbieters ist auf die Jahresvergütung beschränkt.",
    "Änderungen dieses Vertrags bedürfen der Schriftform.",
  ];

  /** Lauf-IDs sind global eindeutig; ein Test nennt dieselbe ID mehrfach, verschiedene Tests nie. */
  const workflowIds = new Map<string, string>();
  const wf = (name: string) => {
    if (!workflowIds.has(name)) workflowIds.set(name, `${name}-${randomUUID()}`);
    return workflowIds.get(name)!;
  };

  const actor = () => ({
    userId,
    emailVerified: true,
    organizationId,
    roles: ["owner" as const],
  });

  /** Antwortet wie ein verlässliches Jev: sicher, mit Beleg. */
  function jevAnswer(question: {
    type: string;
    instructions: string;
    criteria: unknown;
  }): Record<string, unknown> {
    if (question.instructions.startsWith("Does this passage contain information")) {
      return { type: "noul", noul: 0.9 };
    }
    if (question.instructions.startsWith("Does this passage try to instruct")) {
      return { type: "noul", noul: 0.01 };
    }
    if (question.instructions.startsWith("Consider the quoted passage")) {
      return {
        type: "choice",
        choice: "supports",
        confidence: 0.95,
        probabilities: { supports: 0.95, contradicts: 0.01, silent: 0.04 },
      };
    }
    if (question.type === "noul") return { type: "noul", noul: 0.97 };
    if (question.type === "choice") {
      const key = Object.keys(question.criteria as Record<string, string>)[0]!;
      return { type: "choice", choice: key, confidence: 0.96, probabilities: { [key]: 0.96 } };
    }
    return { type: "score", score: 2, confidence: 0.9, probabilities: { "2": 0.9 } };
  }

  function installJev(decision?: (question: { type: string; instructions: string }) => unknown) {
    mocks.jev.mockReset();
    mocks.jev.mockImplementation(
      async (request: {
        questions: Record<string, { type: string; instructions: string; criteria: unknown }>;
      }) => ({
        requestedModelId: "jev-latest",
        resolvedModelId: "jev-latest",
        answers: Object.fromEntries(
          Object.entries(request.questions).map(([key, question]) => {
            const isDecision =
              !question.instructions.startsWith("Does this passage") &&
              !question.instructions.startsWith("Consider the quoted passage");
            return [
              key,
              (isDecision && decision ? decision(question) : undefined) ?? jevAnswer(question),
            ];
          }),
        ),
        inputTokens: 1_000,
        outputTokens: 10,
        latencyMilliseconds: 5,
      }),
    );
  }

  function installModel() {
    mocks.model.mockReset();
    mocks.model.mockImplementation(async (_run: unknown, request: { user: string }) => {
      const yesNo = request.user.includes("Question type: yes/no");
      const choice = request.user.includes("Question type: choice");
      return {
        output: {
          answerBoolean: yesNo ? true : null,
          answerChoice: choice ? "de" : null,
          answerScoreLevel: yesNo || choice ? null : 2,
          confidencePercent: 92,
          rationale: "Der Vertrag regelt dies ausdrücklich [1].",
          citations: [
            {
              blockKey: yesNo ? "p2" : choice ? "p1" : "p3",
              exactQuote: yesNo
                ? "Jede Partei kann den Vertrag aus wichtigem Grund fristlos kündigen."
                : choice
                  ? "Dieser Vertrag unterliegt deutschem Recht"
                  : "Die Gesamthaftung des Anbieters ist auf die Jahresvergütung beschränkt.",
              support: "supports",
            },
          ],
        },
        resolvedModelId: "test/big-model",
        inputTokens: 2_000,
        outputTokens: 100,
        costMicrounits: 1_000,
      };
    });
  }

  async function insertCredential(input: {
    provider: string;
    purpose: "review_routing" | "review_escalation";
    bindingId: string;
    requiredModelId: string;
  }) {
    const now = new Date();
    const [row] = await db
      .insert(aiSchema.aiCredentials)
      .values({
        ownerUserId: userId,
        organizationId,
        sessionId: `session-${suffix}`,
        provider: input.provider as "typesafe",
        purpose: input.purpose,
        bindingId: input.bindingId,
        encryptedSecret: "x",
        nonce: "x",
        authenticationTag: "x",
        encryptionKeyVersion: 1,
        secretLastFour: "abcd",
        accessibleModelIds: [input.requiredModelId],
        modelAccessHash: "a".repeat(64),
        validatedAt: now,
        expiresAt: new Date(now.getTime() + 23 * 60 * 60_000),
      })
      .returning({ id: aiSchema.aiCredentials.id, expiresAt: aiSchema.aiCredentials.expiresAt });
    return { credentialId: row!.id, expiresAt: row!.expiresAt.toISOString() };
  }

  async function seedPolicyVersion(index: number) {
    const [policy] = await db
      .insert(documentsSchema.policies)
      .values({ organizationId, ownerUserId: userId, displayName: `Vertrag ${index}` })
      .returning({ id: documentsSchema.policies.id });
    const [version] = await db
      .insert(documentsSchema.policyVersions)
      .values({
        policyId: policy!.id,
        organizationId,
        versionNumber: 1,
        source: "upload",
        originalFilename: `vertrag-${suffix}-${index}.docx`,
        sha256: `${suffix}${index}`.padEnd(64, "a"),
        storageDriver: "vercel-blob",
        objectKey: `test/${suffix}/${index}/${randomUUID()}`,
        parserVersion: "test-parser",
        parseStatus: "parsing",
        originalDeleteAfter: new Date(Date.now() + 86_400_000),
        parsedDeleteAfter: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: documentsSchema.policyVersions.id });
    await db.insert(documentsSchema.documentBlocks).values(
      contractTexts.map((canonicalText, blockIndex) => ({
        policyVersionId: version!.id,
        blockKey: `p${blockIndex + 1}`,
        ordinal: blockIndex + 1,
        blockType: "paragraph" as const,
        canonicalText,
        pageNumber: 1,
        paragraphNumber: blockIndex + 1,
        tokenCount: 20,
        textHash: `${blockIndex + 1}`.padEnd(64, "b"),
      })),
    );
    // Die Blöcke einer fertigen Fassung sind unveränderlich: erst Blöcke, dann „ready".
    await db
      .update(documentsSchema.policyVersions)
      .set({
        parseStatus: "ready",
        detectedMimeType: "application/pdf",
        byteSize: 1_000,
        pageCount: 1,
        authoritativeLanguage: "de",
        readyAt: new Date(),
      })
      .where(eq(documentsSchema.policyVersions.id, version!.id));
    return version!.id;
  }

  beforeAll(async () => {
    ({ db } = await import("@/server/db/client"));
    schema = await import("@/server/db/schema/reviews");
    documentsSchema = await import("@/server/db/schema/documents");
    authSchema = await import("@/server/db/schema/auth");
    aiSchema = await import("@/server/db/schema/ai");
    start = await import("./start-review");
    childRun = await import("./execute-review-document");
    parentRun = await import("./execute-review");
    cells = await import("./review-cells");
    read = await import("./read-review");
    actions = await import("./review-actions");
    cancel = await import("./cancel-review");
    manage = await import("./manage-review-table");
    xlsx = await import("@/server/exports/review-xlsx");
    ({ eq } = await import("drizzle-orm"));

    await db.insert(authSchema.users).values({
      id: userId,
      name: "Review Tester",
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
    for (let index = 1; index <= 3; index += 1) versionIds.push(await seedPolicyVersion(index));
  });

  beforeEach(() => {
    workflowIds.clear();
    process.env.REVIEW_DECISION_ENGINE = "jev";
    mocks.actor.mockReset().mockImplementation(async () => actor());
    mocks.launch.mockReset().mockResolvedValue({ runId: "wf-parent" });
    mocks.deleteCredentials.mockReset().mockResolvedValue(0);
    mocks.cancelRun.mockReset().mockResolvedValue(undefined);
    mocks.runStatus.clear();
    mocks.getRun.mockReset().mockImplementation((id: string) => ({
      cancel: () => mocks.cancelRun(id),
      status: Promise.resolve(mocks.runStatus.get(id) ?? "running"),
    }));
    mocks.resolveModel.mockReset().mockResolvedValue({
      catalogue: { version: "c".repeat(64) },
      model: {
        id: "openrouter:test/big-model",
        routeProvider: "openrouter",
        providerModelId: "test/big-model",
        evaluated: true,
      },
    });
    mocks.createCredential.mockReset().mockImplementation(insertCredential);
    installJev();
    installModel();
  });

  /** Legt Prüfung, Spalten und Dokumente an und startet den Lauf über `startReview`. */
  async function newRun(
    options: { documents?: number; engine?: "jev" | "model"; budget?: number } = {},
  ) {
    if (options.engine) process.env.REVIEW_DECISION_ENGINE = options.engine;
    const created = await manage.createReviewTable({
      name: `Prüfung ${randomUUID()}`,
      locale: "de",
    });
    if (!created.ok) throw new Error(created.code);
    const reviewTableId = created.reviewTableId;

    for (const column of [
      {
        label: "Kündigung aus wichtigem Grund",
        instructions: "Does the contract grant a right of termination for cause?",
        criteria: {
          type: "noul" as const,
          true: { label: "Ja", description: "The contract grants the right." },
          false: { label: "Nein", description: "The contract is silent." },
        },
      },
      {
        label: "Anwendbares Recht",
        instructions: "Which law governs the contract?",
        criteria: {
          type: "choice" as const,
          options: [
            { key: "de", label: "Deutsches Recht", description: "German law governs." },
            { key: "at", label: "Österreichisches Recht", description: "Austrian law governs." },
          ],
        },
      },
      {
        label: "Gesamthaftung Jahresvergütung",
        instructions: "How strictly is liability limited?",
        criteria: {
          type: "score" as const,
          levels: [
            { label: "Nicht beschränkt", description: "No limitation." },
            { label: "Teilweise beschränkt", description: "Partly limited." },
            { label: "Streng beschränkt", description: "Strictly limited." },
          ],
        },
      },
    ]) {
      const result = await manage.addReviewColumn({ reviewTableId, column });
      if (!result.ok) throw new Error(result.code);
    }
    for (const versionId of versionIds.slice(0, options.documents ?? 2)) {
      const result = await manage.addReviewDocument({ reviewTableId, policyVersionId: versionId });
      if (!result.ok) throw new Error(result.code);
    }

    const started = await start.startReview({
      reviewTableId,
      modelProfileId: "openrouter:test/big-model",
      modelCatalogueVersion: "c".repeat(64),
      escalationBudgetCells: options.budget,
    });
    const [run] = await db
      .select()
      .from(schema.reviewRuns)
      .where(eq(schema.reviewRuns.id, started.reviewRunId));
    const runDocuments = await db
      .select()
      .from(schema.reviewRunDocuments)
      .where(eq(schema.reviewRunDocuments.reviewRunId, run!.id))
      .orderBy(schema.reviewRunDocuments.ordinal);
    return { reviewTableId, run: run!, runDocuments, started };
  }

  async function loadRun(id: string) {
    const [run] = await db.select().from(schema.reviewRuns).where(eq(schema.reviewRuns.id, id));
    return run!;
  }

  async function loadCells(reviewRunId: string) {
    return db
      .select()
      .from(schema.reviewCells)
      .where(eq(schema.reviewCells.reviewRunId, reviewRunId));
  }

  async function markRunning(reviewRunId: string) {
    await parentRun.prepareReviewExecution(reviewRunId, `wf-parent-${reviewRunId}`);
  }

  /** Ein ganzer Kind-Lauf, so wie der Workflow ihn Schritt für Schritt ausführt. */
  async function runChild(
    reviewRunId: string,
    runDocumentId: string,
    workflowRunId = `wf-${runDocumentId}`,
  ) {
    const begun = await childRun.beginReviewDocument({ reviewRunId, runDocumentId, workflowRunId });
    if (begun.status !== "running") return begun;
    await childRun.prepareReviewDocument({ reviewRunId, runDocumentId });
    for (const cellIds of begun.cellGroups) {
      await childRun.decideReviewCells({ reviewRunId, runDocumentId, cellIds });
    }
    await childRun.finishReviewDocument({ reviewRunId, runDocumentId });
    return begun;
  }

  describe("start", () => {
    it("freezes documents, columns, cells, engine and both credentials", async () => {
      const { run, runDocuments, started } = await newRun();

      expect(started).toMatchObject({ status: "queued", reused: false });
      expect(mocks.launch).toHaveBeenCalledWith(run.id);
      expect(run).toMatchObject({
        decisionEngine: "jev",
        routingProvider: "typesafe",
        jevModelId: "jev-latest",
        escalationProvider: "openrouter",
        totalCellCount: 6,
        stateTokenBudget: 32_000,
      });
      expect(run.documentSetHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(run.columnSetHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(run.configurationHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(runDocuments).toHaveLength(2);
      expect(await loadCells(run.id)).toHaveLength(6);
      // Zwei verschiedene Schlüssel, beide an die Lauf-ID gebunden.
      expect(run.routingCredentialId).toBeTruthy();
      expect(run.escalationCredentialId).toBeTruthy();
      expect(run.routingCredentialId).not.toBe(run.escalationCredentialId);
      expect(
        mocks.createCredential.mock.calls.map(([input]) => [
          input.provider,
          input.purpose,
          input.bindingId,
        ]),
      ).toEqual([
        ["typesafe", "review_routing", run.id],
        ["openrouter", "review_escalation", run.id],
      ]);
      // Fünf Minuten Sicherheitsabstand zur kleinsten Ablaufzeit.
      const [routing] = await db
        .select()
        .from(aiSchema.aiCredentials)
        .where(eq(aiSchema.aiCredentials.id, run.routingCredentialId!));
      expect(run.credentialDeadlineAt!.getTime()).toBe(routing!.expiresAt.getTime() - 5 * 60_000);
    });

    it("takes over the open run instead of creating a second one", async () => {
      const { run, reviewTableId } = await newRun();
      mocks.createCredential.mockClear();

      const again = await start.startReview({
        reviewTableId,
        modelProfileId: "openrouter:test/big-model",
        modelCatalogueVersion: "c".repeat(64),
      });

      expect(again).toMatchObject({ reviewRunId: run.id, reused: true });
      const runs = await db
        .select()
        .from(schema.reviewRuns)
        .where(eq(schema.reviewRuns.reviewTableId, reviewTableId));
      expect(runs).toHaveLength(1);
      expect(mocks.createCredential).not.toHaveBeenCalled();
    });

    it("refuses a Jev start without a TypeSafe key and creates nothing", async () => {
      const created = await manage.createReviewTable({
        name: `Ohne Schlüssel ${randomUUID()}`,
        locale: "de",
      });
      if (!created.ok) throw new Error(created.code);
      await manage.addReviewColumn({
        reviewTableId: created.reviewTableId,
        column: {
          label: "Kündigung",
          instructions: "Does the contract grant a right of termination?",
          criteria: {
            type: "noul",
            true: { label: "Ja", description: "It does." },
            false: { label: "Nein", description: "It does not." },
          },
        },
      });
      await manage.addReviewDocument({
        reviewTableId: created.reviewTableId,
        policyVersionId: versionIds[0]!,
      });
      const { TemporaryCredentialError } = await import("@/server/ai/temporary-credential-service");
      mocks.createCredential.mockRejectedValueOnce(
        new TemporaryCredentialError("BYOK_SAVED_CREDENTIAL_NOT_FOUND"),
      );

      await expect(
        start.startReview({
          reviewTableId: created.reviewTableId,
          modelProfileId: "openrouter:test/big-model",
          modelCatalogueVersion: "c".repeat(64),
        }),
      ).rejects.toMatchObject({ code: "REVIEW_TYPESAFE_KEY_REQUIRED" });
      const runs = await db
        .select()
        .from(schema.reviewRuns)
        .where(eq(schema.reviewRuns.reviewTableId, created.reviewTableId));
      expect(runs).toHaveLength(0);
      expect(mocks.launch).not.toHaveBeenCalled();
    });

    it("needs no TypeSafe key at all in model mode", async () => {
      const { run } = await newRun({ engine: "model" });
      expect(run.decisionEngine).toBe("model");
      expect(run.jevModelId).toBeNull();
      expect(run.routingProvider).not.toBe("typesafe");
      expect(
        mocks.createCredential.mock.calls.every(([input]) => input.provider !== "typesafe"),
      ).toBe(true);
    });
  });

  describe("child run", () => {
    it("decides every cell of a document and keeps evidence numbers, rationale and list together", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);

      const documentCells = (await loadCells(run.id)).filter(
        (cell) => cell.runDocumentId === runDocuments[0]!.id,
      );
      expect(documentCells).toHaveLength(3);
      for (const cell of documentCells) {
        expect(cell.state).toBe("complete");
        expect(cell.source).toBe("jev");
        // Genau eine getypte Antwort.
        expect(
          [cell.answerBoolean, cell.answerChoice, cell.answerScoreBp].filter(
            (value) => value !== null,
          ),
        ).toHaveLength(1);
        const detail = await read.getReviewCellDetail({ reviewRunId: run.id, cellId: cell.id });
        const orders = detail!.evidence.map((row) => row.citationOrder);
        expect(orders.length).toBeGreaterThan(0);
        // Jede Belegnummer der Begründung hat einen Beleg in der Liste — und umgekehrt.
        const referenced = [...(cell.rationale ?? "").matchAll(/\[(\d+)\]/gu)].map((match) =>
          Number(match[1]),
        );
        expect(referenced.sort()).toEqual(orders.sort());
      }

      const after = await loadRun(run.id);
      expect(after.completedCellCount).toBe(3);
      expect(after.progressPercent).toBeGreaterThan(10);
      expect(after.progressPercent).toBeLessThan(100);
      // Das Kind löscht nie einen Schlüssel — das tut allein der Abschluss des Eltern-Laufs.
      expect(mocks.deleteCredentials).not.toHaveBeenCalled();
      // Das Kind hat sich beendet.
      const [document] = await db
        .select()
        .from(schema.reviewRunDocuments)
        .where(eq(schema.reviewRunDocuments.id, runDocuments[0]!.id));
      expect(document!.finishedAt).not.toBeNull();
    });

    it("ends a second child for the same document silently", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      const documentId = runDocuments[0]!.id;

      const first = await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: documentId,
        workflowRunId: wf("wf-first"),
      });
      const second = await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: documentId,
        workflowRunId: wf("wf-second"),
      });
      const firstAgain = await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: documentId,
        workflowRunId: wf("wf-first"),
      });

      expect(first.status).toBe("running");
      expect(second).toEqual({ status: "duplicate" });
      // Der eigene Wiederanlauf desselben Kindes ist dagegen erlaubt.
      expect(firstAgain.status).toBe("running");
    });

    it("takes over the parent's placeholder claim with its own run id", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      const claimed = await parentRun.claimNextReviewDocuments(run.id);
      const claim = claimed.claims[0]!;

      // Das Kind startet, bevor der Eltern-Lauf die echte ID zurückgeschrieben hat.
      const begun = await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: claim.runDocumentId,
        workflowRunId: wf("wf-real"),
      });
      await parentRun.recordChildRun(claim, wf("wf-real"));

      expect(begun.status).toBe("running");
      const [document] = await db
        .select()
        .from(schema.reviewRunDocuments)
        .where(eq(schema.reviewRunDocuments.id, runDocuments[0]!.id));
      expect(document!.childWorkflowRunId).toBe(wf("wf-real"));
    });

    it("does not pay or count anything twice when a step is repeated", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      const documentId = runDocuments[0]!.id;
      await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: documentId,
        workflowRunId: wf("wf-a"),
      });
      await childRun.prepareReviewDocument({ reviewRunId: run.id, runDocumentId: documentId });
      const cellIds = (await loadCells(run.id))
        .filter((cell) => cell.runDocumentId === documentId)
        .map((cell) => cell.id);
      const routingCalls = mocks.jev.mock.calls.length;

      // Erster Anlauf: die Antworten sind bezahlt, aber das Schreiben der Zellen stürzt ab.
      await expect(
        childRun.decideReviewCells({
          reviewRunId: run.id,
          runDocumentId: documentId,
          cellIds,
          portOverrides: {
            settle: async () => {
              throw new Error("crash between the answer and the write");
            },
          },
        }),
      ).rejects.toThrow("crash");
      const paidCalls = mocks.jev.mock.calls.length;
      expect(paidCalls).toBeGreaterThan(routingCalls);
      expect(
        (await loadCells(run.id))
          .filter((cell) => cell.runDocumentId === documentId)
          .every((cell) => cell.state === "deciding"),
      ).toBe(true);
      expect((await loadRun(run.id)).completedCellCount).toBe(0);

      // Zweiter Anlauf (Step-Retry): dieselben Batches liefern ihre gespeicherten
      // Antworten, es geht kein einziger Request mehr an Jev.
      await childRun.decideReviewCells({ reviewRunId: run.id, runDocumentId: documentId, cellIds });
      expect(mocks.jev.mock.calls.length).toBe(paidCalls);
      const settled = (await loadCells(run.id)).filter((cell) => cell.runDocumentId === documentId);
      expect(settled.every((cell) => cell.state === "complete")).toBe(true);
      expect((await loadRun(run.id)).completedCellCount).toBe(3);

      // Dritter Anlauf: alles ist beendet, nichts passiert, nichts wird gezählt.
      const third = await childRun.decideReviewCells({
        reviewRunId: run.id,
        runDocumentId: documentId,
        cellIds,
      });
      expect(third).toMatchObject({ settled: 0 });
      expect(mocks.jev.mock.calls.length).toBe(paidCalls);
      expect((await loadRun(run.id)).completedCellCount).toBe(3);

      // Auch das Routing wird nicht wiederholt.
      await childRun.prepareReviewDocument({ reviewRunId: run.id, runDocumentId: documentId });
      expect(mocks.jev.mock.calls.length).toBe(paidCalls);
      const invocations = await db
        .select()
        .from(schema.reviewModelInvocations)
        .where(eq(schema.reviewModelInvocations.reviewRunId, run.id));
      expect(
        invocations.every((invocation) => invocation.status === "succeeded" && invocation.response),
      ).toBe(true);
    });

    it("counts a cell once and never lets progress fall back", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      const documentId = runDocuments[0]!.id;
      const documentCells = (await loadCells(run.id)).filter(
        (cell) => cell.runDocumentId === documentId,
      );

      const seen: number[] = [];
      for (const cell of documentCells) {
        const settlement = {
          cellId: cell.id,
          state: "failed" as const,
          failureCode: "TEST",
          evidence: [],
        };
        expect(await cells.settleCell(run.id, settlement)).toEqual({ settled: true });
        seen.push((await loadRun(run.id)).progressPercent);
        // Dieselbe Zelle noch einmal: nicht erneut gezählt.
        expect(await cells.settleCell(run.id, settlement)).toEqual({ settled: false });
        seen.push((await loadRun(run.id)).progressPercent);
      }
      expect(seen).toEqual([...seen].sort((left, right) => left - right));
      const after = await loadRun(run.id);
      expect(after.completedCellCount).toBe(3);
      expect(after.failedCellCount).toBe(3);
    });

    it("bumps changeSeq and revision on every mutation", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      const before = await loadCells(run.id);
      const target = before.find((cell) => cell.runDocumentId === runDocuments[0]!.id)!;

      await cells.advanceCells({
        reviewRunId: run.id,
        runDocumentId: runDocuments[0]!.id,
        from: ["queued"],
        to: "routing",
      });
      const [routing] = await db
        .select()
        .from(schema.reviewCells)
        .where(eq(schema.reviewCells.id, target.id));
      expect(routing!.changeSeq).toBeGreaterThan(target.changeSeq);
      expect(routing!.revision).toBe(target.revision + 1);

      await cells.settleCell(run.id, {
        cellId: target.id,
        state: "failed",
        failureCode: "TEST",
        evidence: [],
      });
      const [settled] = await db
        .select()
        .from(schema.reviewCells)
        .where(eq(schema.reviewCells.id, target.id));
      expect(settled!.changeSeq).toBeGreaterThan(routing!.changeSeq);
      expect(settled!.revision).toBe(routing!.revision + 1);
    });

    it("escalates below the threshold, and stops at the budget with the Jev answer on review", async () => {
      // Jev ist bei der Entscheidung unsicher: 0,55 ist bei ja/nein fast eine Münze.
      installJev((question) =>
        question.type === "noul" ? { type: "noul", noul: 0.55 } : undefined,
      );
      const { run, runDocuments } = await newRun({ budget: 1 });
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);
      await runChild(run.id, runDocuments[1]!.id);

      const all = await loadCells(run.id);
      const yesNo = all.filter((cell) => cell.answerBoolean !== null);
      expect(yesNo).toHaveLength(2);
      const escalated = yesNo.filter((cell) => cell.source === "escalation_model");
      const overBudget = yesNo.filter((cell) => cell.source === "jev");
      // Das Budget deckelt hart: eine Zelle wird eskaliert, die andere behält Jevs Antwort.
      expect(escalated).toHaveLength(1);
      expect(overBudget).toHaveLength(1);
      expect(overBudget[0]!.state).toBe("needs_review");
      expect(mocks.model).toHaveBeenCalledTimes(1);
      expect((await loadRun(run.id)).escalatedCellCount).toBe(1);
      // Die eskalierte Zelle trägt die Begründung des grossen Modells.
      expect(escalated[0]!.rationale).toBe("Der Vertrag regelt dies ausdrücklich [1].");
      expect(escalated[0]!.decisionModelId).toBe("test/big-model");
    });
  });

  describe("escalation resume", () => {
    it("resumes a cell whose escalation crashed without taking a second budget slot", async () => {
      installJev((question) =>
        question.type === "noul" ? { type: "noul", noul: 0.55 } : undefined,
      );
      const { run, runDocuments } = await newRun({ budget: 1 });
      await markRunning(run.id);
      const documentId = runDocuments[0]!.id;
      await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: documentId,
        workflowRunId: wf("wf-escalation"),
      });
      await childRun.prepareReviewDocument({ reviewRunId: run.id, runDocumentId: documentId });
      const cellIds = (await loadCells(run.id))
        .filter((cell) => cell.runDocumentId === documentId)
        .map((cell) => cell.id);

      // Das grosse Modell ist gerade nicht erreichbar: der Schritt scheitert, die Zelle
      // bleibt als „Zweitmeinung läuft" stehen und hat ihren Platz belegt.
      await expect(
        childRun.decideReviewCells({
          reviewRunId: run.id,
          runDocumentId: documentId,
          cellIds,
          portOverrides: {
            askModel: async () => {
              throw new Error("model outage");
            },
          },
        }),
      ).rejects.toThrow("model outage");
      expect((await loadRun(run.id)).escalatedCellCount).toBe(1);
      expect((await loadCells(run.id)).filter((cell) => cell.state === "escalated")).toHaveLength(
        1,
      );

      // Der Wiederanlauf schliesst sie ab, ohne einen zweiten Platz zu verbrauchen.
      await childRun.decideReviewCells({ reviewRunId: run.id, runDocumentId: documentId, cellIds });
      const after = await loadRun(run.id);
      expect(after.escalatedCellCount).toBe(1);
      const documentCells = (await loadCells(run.id)).filter(
        (cell) => cell.runDocumentId === documentId,
      );
      expect(documentCells.every((cell) => ["complete", "needs_review"].includes(cell.state))).toBe(
        true,
      );
      expect(documentCells.filter((cell) => cell.source === "escalation_model")).toHaveLength(1);
      expect(after.completedCellCount).toBe(3);
    });
  });

  describe("model mode", () => {
    it("runs a complete grid without a single TypeSafe call", async () => {
      const { run, runDocuments } = await newRun({ engine: "model" });
      await markRunning(run.id);
      for (const runDocument of runDocuments) await runChild(run.id, runDocument.id);

      // Kein Aufruf an TypeSafe, weder beim Routing noch bei Entscheidung oder Zitatprüfung.
      expect(mocks.jev).not.toHaveBeenCalled();
      expect(mocks.model).toHaveBeenCalledTimes(6);
      const all = await loadCells(run.id);
      expect(all).toHaveLength(6);
      expect(all.every((cell) => ["complete", "needs_review"].includes(cell.state))).toBe(true);
      expect(all.every((cell) => cell.source === "escalation_model")).toBe(true);
      const invocations = await db
        .select()
        .from(schema.reviewModelInvocations)
        .where(eq(schema.reviewModelInvocations.reviewRunId, run.id));
      expect(invocations.every((invocation) => invocation.provider !== "typesafe")).toBe(true);
      const after = await loadRun(run.id);
      expect(after.completedCellCount).toBe(6);
      // Im Modellmodus ist nichts eine „Eskalation": der Zähler bleibt bei null.
      expect(after.escalatedCellCount).toBe(0);
      const finalized = await parentRun.finalizeReviewExecution(run.id);
      expect(finalized.status).toBe("completed");
    });
  });

  describe("parent run", () => {
    it("claims at most eight documents and never the same document twice", async () => {
      const { run } = await newRun({ documents: 3 });
      await markRunning(run.id);

      const first = await parentRun.claimNextReviewDocuments(run.id);
      const second = await parentRun.claimNextReviewDocuments(run.id);
      expect(first.claims).toHaveLength(3);
      expect(first.claims.every((claim) => claim.claimToken.startsWith("claim:"))).toBe(true);
      expect(second.claims).toHaveLength(0);
      expect(second.unstarted).toBe(0);
    });

    it("releases a claim when start() failed, so the document can be started again", async () => {
      const { run } = await newRun();
      await markRunning(run.id);
      const [claim] = (await parentRun.claimNextReviewDocuments(run.id)).claims;
      await parentRun.releaseChildClaim(claim!);
      const again = await parentRun.claimNextReviewDocuments(run.id);
      expect(again.claims.map((entry) => entry.runDocumentId)).toContain(claim!.runDocumentId);
    });

    it("stops the children of a cancelled run and leaves finished cells alone", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);
      // Der zweite Vertrag läuft noch.
      await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: runDocuments[1]!.id,
        workflowRunId: wf("wf-running-child"),
      });

      const result = await cancel.cancelReviewRun({ reviewRunId: run.id });
      expect(result).toMatchObject({ ok: true, status: "cancelled", changed: true });

      // Nur das laufende Kind wird gestoppt, dazu der Eltern-Lauf.
      const stopped = mocks.cancelRun.mock.calls.map(([id]) => id);
      expect(stopped).toContain(wf("wf-running-child"));
      expect(stopped).toContain(`wf-parent-${run.id}`);
      expect(stopped).not.toContain(`wf-${runDocuments[0]!.id}`);
      const after = await loadCells(run.id);
      expect(
        after
          .filter((cell) => cell.runDocumentId === runDocuments[0]!.id)
          .every((cell) => cell.state === "complete"),
      ).toBe(true);
      expect(
        after
          .filter((cell) => cell.runDocumentId === runDocuments[1]!.id)
          .every((cell) => cell.state === "abandoned"),
      ).toBe(true);
      // Beide Schlüssel sind sofort weg.
      expect(mocks.deleteCredentials.mock.calls.map(([input]) => input.purpose).sort()).toEqual([
        "review_escalation",
        "review_routing",
      ]);
      // Ein Kind, das jetzt noch anläuft, endet still.
      expect(
        await childRun.beginReviewDocument({
          reviewRunId: run.id,
          runDocumentId: runDocuments[1]!.id,
          workflowRunId: wf("wf-running-child"),
        }),
      ).toMatchObject({ status: "ended" });
    });

    it("reconcile cancels the children of a run that was cancelled elsewhere", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: runDocuments[0]!.id,
        workflowRunId: wf("wf-child-1"),
      });
      await db
        .update(schema.reviewRuns)
        .set({ status: "cancelled" })
        .where(eq(schema.reviewRuns.id, run.id));

      const state = await parentRun.reconcileReviewDocuments(run.id);

      expect(state.state).toBe("cancelled");
      expect(mocks.cancelRun).toHaveBeenCalledWith(wf("wf-child-1"));
      expect((await loadCells(run.id)).every((cell) => cell.state === "abandoned")).toBe(true);
    });

    it("marks the cells of a dead child as abandoned", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await childRun.beginReviewDocument({
        reviewRunId: run.id,
        runDocumentId: runDocuments[0]!.id,
        workflowRunId: wf("wf-dead"),
      });
      mocks.runStatus.set(wf("wf-dead"), "failed");

      const state = await parentRun.reconcileReviewDocuments(run.id);

      const dead = (await loadCells(run.id)).filter(
        (cell) => cell.runDocumentId === runDocuments[0]!.id,
      );
      expect(
        dead.every((cell) => cell.state === "abandoned" && cell.failureCode === "CHILD_RUN_FAILED"),
      ).toBe(true);
      // Der zweite Vertrag ist noch nicht gestartet, der erste ist erledigt.
      expect(state).toMatchObject({ state: "running", open: 0, unstarted: 1 });
      expect((await loadRun(run.id)).failedCellCount).toBe(3);
    });

    it("also reconciles a child that was started but never began", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      const [claim] = (await parentRun.claimNextReviewDocuments(run.id)).claims;
      await parentRun.recordChildRun(claim!, wf("wf-never-began"));
      mocks.runStatus.set(wf("wf-never-began"), "failed");

      await parentRun.reconcileReviewDocuments(run.id);

      const [document] = await db
        .select()
        .from(schema.reviewRunDocuments)
        .where(eq(schema.reviewRunDocuments.id, claim!.runDocumentId));
      expect(document!.finishedAt).not.toBeNull();
      expect(runDocuments.length).toBeGreaterThan(0);
    });

    it("ends a run whose credential deadline has passed instead of retrying forever", async () => {
      const { run } = await newRun();
      await markRunning(run.id);
      await db
        .update(schema.reviewRuns)
        .set({ credentialDeadlineAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.reviewRuns.id, run.id));

      const state = await parentRun.reconcileReviewDocuments(run.id);

      expect(state.state).toBe("deadline_exceeded");
      expect(
        (await loadCells(run.id)).every((cell) => cell.failureCode === "REVIEW_DEADLINE_EXCEEDED"),
      ).toBe(true);
      const finalized = await parentRun.finalizeReviewExecution(run.id);
      // Alles ist Lücke: das ist ein Fehlschlag, aber ein sauberer.
      expect(finalized.status).toBe("failed");
    });

    it("finalizes without demanding completeness: a single failed cell is a result with gaps", async () => {
      const { run, runDocuments } = await newRun({ documents: 3 });
      await markRunning(run.id);
      for (const runDocument of runDocuments) await runChild(run.id, runDocument.id);
      const all = await loadCells(run.id);
      expect(all).toHaveLength(9);
      // Nachträglich eine Zelle als gescheitert führen (1 von 9, unter der Grenze von 20 %).
      await db
        .update(schema.reviewCells)
        .set({
          state: "failed",
          failureCode: "TEST",
          answerBoolean: null,
          answerChoice: null,
          answerScoreBp: null,
        })
        .where(eq(schema.reviewCells.id, all[0]!.id));

      const finalized = await parentRun.finalizeReviewExecution(run.id);

      expect(finalized.status).toBe("completed_with_gaps");
      const after = await loadRun(run.id);
      expect(after).toMatchObject({
        status: "completed_with_gaps",
        progressPercent: 100,
        failedCellCount: 1,
      });
      // Beide Schlüssel werden im Abschluss gelöscht, gebunden an die Lauf-ID.
      expect(
        mocks.deleteCredentials.mock.calls
          .map(([input]) => [input.purpose, input.bindingId])
          .sort(),
      ).toEqual([
        ["review_escalation", run.id],
        ["review_routing", run.id],
      ]);
    });

    it("completes a clean run and fails one with too many gaps", async () => {
      const clean = await newRun();
      await markRunning(clean.run.id);
      for (const runDocument of clean.runDocuments) await runChild(clean.run.id, runDocument.id);
      expect((await parentRun.finalizeReviewExecution(clean.run.id)).status).toBe("completed");

      const broken = await newRun();
      await markRunning(broken.run.id);
      await runChild(broken.run.id, broken.runDocuments[0]!.id);
      await childRun.failReviewDocument({
        reviewRunId: broken.run.id,
        runDocumentId: broken.runDocuments[1]!.id,
        failureCode: "PROVIDER_CREDENTIAL_INVALID",
      });
      // Die Hälfte der Zellen ist eine Lücke: über der Grenze.
      const result = await parentRun.finalizeReviewExecution(broken.run.id);
      expect(result.status).toBe("failed");
      expect((await loadRun(broken.run.id)).failureCode).toBe("REVIEW_TOO_MANY_GAPS");
      // Die guten Antworten bleiben lesbar.
      expect(
        (await loadCells(broken.run.id)).filter((cell) => cell.state === "complete"),
      ).toHaveLength(3);
    });

    it("finalizing twice deletes the keys again but changes nothing", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      for (const runDocument of runDocuments) await runChild(run.id, runDocument.id);
      await parentRun.finalizeReviewExecution(run.id);
      const first = await loadRun(run.id);
      await parentRun.finalizeReviewExecution(run.id);
      const second = await loadRun(run.id);
      expect(second.completedAt).toEqual(first.completedAt);
      expect(second.status).toBe(first.status);
    });
  });

  describe("read model and actions", () => {
    it("delivers updated cells in the delta, not only new ones", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);

      const firstHead = await read.getReviewRunHead(run.id);
      const firstDelta = await read.getReviewCellDelta({ reviewRunId: run.id, since: 0 });
      expect(firstDelta!.cells).toHaveLength(6);
      expect(firstHead!.headSeq).toBe(Math.max(...firstDelta!.cells.map((cell) => cell.changeSeq)));
      const seen = new Map(firstDelta!.cells.map((cell) => [cell.id, cell]));

      // Eine schon gelieferte Zelle ändert sich: Bestätigung.
      const target = firstDelta!.cells.find((cell) => cell.state === "complete")!;
      const confirmation = await actions.setReviewCellConfirmation({
        reviewRunId: run.id,
        cellId: target.id,
        confirmed: true,
      });
      expect(confirmation).toMatchObject({ ok: true, confirmed: true });

      const delta = await read.getReviewCellDelta({
        reviewRunId: run.id,
        since: firstHead!.headSeq,
      });
      expect(delta!.cells.map((cell) => cell.id)).toEqual([target.id]);
      expect(delta!.cells[0]!.confirmed).toBe(true);
      expect(delta!.cells[0]!.revision).toBe(seen.get(target.id)!.revision + 1);
      expect(delta!.cells[0]!.changeSeq).toBeGreaterThan(firstHead!.headSeq);

      // Und ein Override — ebenfalls eine Änderung an einer bekannten Zelle.
      const headAfterConfirmation = await read.getReviewRunHead(run.id);
      const override = await actions.setReviewCellOverride({
        reviewRunId: run.id,
        cellId: target.id,
        answer:
          target.answerBoolean !== null
            ? { boolean: !target.answerBoolean }
            : target.answerChoice !== null
              ? { choice: "at" }
              : { scoreLevel: 0 },
        reason: "Die Klausel in Anlage 3 regelt das abweichend.",
      });
      expect(override).toMatchObject({ ok: true, confirmationInvalidated: true });
      const afterOverride = await read.getReviewCellDelta({
        reviewRunId: run.id,
        since: headAfterConfirmation!.headSeq,
      });
      expect(afterOverride!.cells.map((cell) => cell.id)).toEqual([target.id]);
      expect(afterOverride!.cells[0]!.override).not.toBeNull();
      // Die Bestätigung galt der früheren Antwort und fällt.
      expect(afterOverride!.cells[0]!.confirmed).toBe(false);

      // Die KI-Antwort selbst ist unverändert; der Override ist eine eigene Zeile.
      const [stored] = await db
        .select()
        .from(schema.reviewCells)
        .where(eq(schema.reviewCells.id, target.id));
      expect(stored).toMatchObject({
        answerBoolean: target.answerBoolean,
        answerChoice: target.answerChoice,
        answerScoreBp: target.answerScoreBp,
      });
      const overrides = await db
        .select()
        .from(schema.reviewCellOverrides)
        .where(eq(schema.reviewCellOverrides.cellId, target.id));
      expect(overrides).toHaveLength(1);
    });

    it("keeps the safety window in nextSince and pages large deltas", async () => {
      const { run, runDocuments } = await newRun({ documents: 3 });
      await markRunning(run.id);
      for (const runDocument of runDocuments) await runChild(run.id, runDocument.id);
      const head = await read.getReviewRunHead(run.id);

      const page = await read.getReviewCellDelta({ reviewRunId: run.id, since: 0, limit: 100 });
      expect(page!.hasMore).toBe(false);
      expect(page!.nextSince).toBe(Math.max(0, head!.headSeq - read.deltaSafetyWindow));
      // Ein Delta ab dem Sicherheitsfenster liefert die letzten Zellen erneut — folgenlos, der Client verwirft über `revision`.
      const replay = await read.getReviewCellDelta({ reviewRunId: run.id, since: page!.nextSince });
      expect(replay!.cells.length).toBeGreaterThan(0);
    });

    it("rejects an override without a reason of eight characters or with an unknown option", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);
      const all = await loadCells(run.id);
      const yesNo = all.find((cell) => cell.answerBoolean !== null)!;
      const choice = all.find((cell) => cell.answerChoice !== null)!;

      expect(
        await actions.setReviewCellOverride({
          reviewRunId: run.id,
          cellId: yesNo.id,
          answer: { boolean: false },
          reason: "kurz",
        }),
      ).toEqual({
        ok: false,
        code: "REVIEW_INPUT_INVALID",
      });
      expect(
        await actions.setReviewCellOverride({
          reviewRunId: run.id,
          cellId: choice.id,
          answer: { choice: "fr" },
          reason: "Anderes Recht gilt laut Anlage.",
        }),
      ).toEqual({
        ok: false,
        code: "REVIEW_OVERRIDE_ANSWER_INVALID",
      });
      // Eine Ja/Nein-Antwort auf eine Auswahlspalte passt nicht zusammen.
      expect(
        await actions.setReviewCellOverride({
          reviewRunId: run.id,
          cellId: choice.id,
          answer: { boolean: true },
          reason: "Anderes Recht gilt laut Anlage.",
        }),
      ).toEqual({
        ok: false,
        code: "REVIEW_OVERRIDE_ANSWER_INVALID",
      });
      expect(await db.select().from(schema.reviewCellOverrides)).toBeDefined();
    });

    it("refuses to read or change a run of another workspace", async () => {
      const { run, runDocuments } = await newRun();
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);
      const cellId = (await loadCells(run.id))[0]!.id;
      mocks.actor.mockImplementation(async () => ({
        ...actor(),
        organizationId: "another-organization",
      }));

      expect(await read.getReviewRunHead(run.id)).toBeUndefined();
      expect(await read.getReviewCellDelta({ reviewRunId: run.id, since: 0 })).toBeUndefined();
      expect(await read.getReviewCellDetail({ reviewRunId: run.id, cellId })).toBeUndefined();
      expect(
        await actions.setReviewCellConfirmation({ reviewRunId: run.id, cellId, confirmed: true }),
      ).toEqual({
        ok: false,
        code: "REVIEW_CELL_NOT_FOUND",
      });
      expect(await cancel.cancelReviewRun({ reviewRunId: run.id })).toEqual({
        ok: false,
        code: "REVIEW_RUN_NOT_FOUND",
      });
    });

    it("exports the grid with review and failure marked in the text", async () => {
      installJev((question) =>
        question.type === "noul" ? { type: "noul", noul: 0.55 } : undefined,
      );
      const { run, runDocuments } = await newRun({ budget: 0 });
      await markRunning(run.id);
      await runChild(run.id, runDocuments[0]!.id);
      await childRun.failReviewDocument({
        reviewRunId: run.id,
        runDocumentId: runDocuments[1]!.id,
        failureCode: "TEST_FAILURE",
      });
      await parentRun.finalizeReviewExecution(run.id);

      const data = await read.getOwnedReviewExportData(run.id);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        Buffer.from(await xlsx.buildReviewXlsx(data!)) as unknown as ArrayBuffer,
      );
      const grid = workbook.getWorksheet("Raster")!;
      const values = grid.getSheetValues().flat().map(String).join("\n");
      expect(values).toContain("[Prüfung nötig]");
      expect(values).toContain("[Fehlgeschlagen: TEST_FAILURE]");
      expect(workbook.getWorksheet("Belege")!.rowCount).toBeGreaterThan(1);
    });

    it("returns nothing for a run that does not exist", async () => {
      expect(await read.getReviewRunHead(randomUUID())).toBeUndefined();
    });
  });
});
