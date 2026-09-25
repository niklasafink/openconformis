// @vitest-environment node

/**
 * Vollständigkeitsprüfung gegen eine **echte** PostgreSQL-Datenbank: Schnappschuss der
 * Checkliste, Idempotenz des Starts, Zitatprüfung und das Vier-Augen-Prinzip je Position
 * hängen an SQL-Bedingungen, die ein Mock nicht abbildet.
 *
 * Läuft nur mit `DISCLOSURE_TEST_DATABASE_URL` auf einer **Wegwerf-Datenbank** mit
 * angewendeten Migrationen; ohne die Variable werden die Tests übersprungen.
 *
 *   DISCLOSURE_TEST_DATABASE_URL=postgresql://conformis:conformis@127.0.0.1:5432/conformis_e2e \
 *     pnpm exec vitest run src/server/disclosure/completeness.db.test.ts
 *
 * Kein Aufruf geht an einen Anbieter: Modell, Schlüssel und Workflow-Start sind ersetzt.
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
  administrator: vi.fn(),
  objects: new Map<string, Uint8Array>(),
}));

vi.mock("./actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actor")>()),
  resolveDisclosureActor: mocks.actor,
}));
vi.mock("@/server/workflows/launch", () => ({
  launchDisclosureCompletenessWorkflow: mocks.launch,
  launchDisclosurePlausibilityWorkflow: vi.fn(),
  launchDisclosureRecognitionWorkflow: vi.fn(),
}));
vi.mock("./model-route", () => ({ requestStructuredForDisclosure: mocks.model }));
vi.mock("@/server/catalogue/administrator", () => ({
  requireCatalogueAdministrator: mocks.administrator,
}));
vi.mock("@/server/storage/object-store", () => ({
  createPrivateObjectStore: () => ({
    headObject: async (key: string) => {
      const bytes = mocks.objects.get(key);
      return bytes
        ? {
            contentLength: bytes.byteLength,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }
        : null;
    },
    getObjectBytes: async (key: string) => mocks.objects.get(key)!,
    deleteObject: async (key: string) => void mocks.objects.delete(key),
  }),
}));
vi.mock("@/server/ai/credential-cleanup", () => ({
  deleteTemporaryCredentialsForBinding: mocks.deleteCredentials,
  deleteTemporaryCredential: vi.fn(async () => undefined),
}));

type Db = typeof import("@/server/db/client").db;

const suite = enabled ? describe : describe.skip;

const reportBlocks = [
  "Anhang für das Geschäftsjahr 2021",
  "Im Geschäftsjahr waren durchschnittlich 52 Arbeitnehmer beschäftigt, davon 40 Angestellte und 12 Auszubildende.",
  "Das Honorar des Abschlussprüfers ist im Konzernabschluss der Muttergesellschaft angegeben.",
  "Die Bilanzierungs- und Bewertungsmethoden wurden gegenüber dem Vorjahr unverändert angewandt.",
];

/** Ein Modell, das beim Honorar ein Zitat erfindet und sonst ehrlich antwortet. */
function modelAnswer(_run: unknown, request: { user: string }) {
  const input = JSON.parse(request.user) as {
    checklistItem: { title: string };
    evidenceCandidates: Array<{ blockKey: string; text: string }>;
  };
  const title = input.checklistItem.title;
  const block = (needle: string) =>
    input.evidenceCandidates.find((candidate) => candidate.text.includes(needle));
  const employees = block("Arbeitnehmer");
  if (/Arbeitnehmer/u.test(title) && employees) {
    return {
      output: {
        status: "fulfilled",
        explanation: "- Die durchschnittliche Zahl der Arbeitnehmer ist nach Gruppen angegeben.",
        confidencePercent: 90,
        evidence: [
          {
            blockKey: employees.blockKey,
            exactQuote: "durchschnittlich 52 Arbeitnehmer beschäftigt",
            support: "supports",
          },
        ],
        missingInformation: [],
      },
    };
  }
  const fee = block("Honorar");
  if (/Honorar/u.test(title) && fee) {
    return {
      output: {
        status: "fulfilled",
        explanation: "- Das Honorar ist nach allen vier Kategorien aufgeschlüsselt.",
        confidencePercent: 95,
        // Erfunden: steht so in keinem Block.
        evidence: [
          {
            blockKey: fee.blockKey,
            exactQuote: "Das Honorar betrug TEUR 45 für Abschlussprüfungsleistungen.",
            support: "supports",
          },
        ],
        missingInformation: [],
      },
    };
  }
  return {
    output: {
      status: "no_assessment_possible",
      explanation: "- Der Bericht enthält dazu keine belastbare Aussage.",
      confidencePercent: 30,
      evidence: [],
      missingInformation: ["Angabe im Bericht"],
    },
  };
}

suite("disclosure completeness runs against a real database", () => {
  let db: Db;
  let eq: typeof import("drizzle-orm").eq;
  let and: typeof import("drizzle-orm").and;
  let inArray: typeof import("drizzle-orm").inArray;
  let schema: typeof import("@/server/db/schema/disclosure");
  let completeness: typeof import("@/server/db/schema/disclosure-completeness");
  let checklists: typeof import("./checklists");
  let run: typeof import("./completeness-run");
  let execute: typeof import("./execute-run");
  let review: typeof import("./completeness-review");
  let templateReleaseId = "";

  const suffix = randomUUID().slice(0, 8);
  const userId = `c-user-${suffix}`;
  const managerId = `c-manager-${suffix}`;
  const organizationId = `c-org-${suffix}`;
  let caseId = "";

  const discard = vi.fn(async () => undefined);
  const prepareModel = vi.fn(async () => ({
    model: {
      routeProvider: "openrouter",
      providerModelId: "test/model",
      modelProfileId: "openrouter:test/model",
      modelCatalogueVersion: "catalogue-1",
      promptVersion: "disclosure-assignment-v1",
    },
    credentialId: randomUUID(),
    deadline: new Date(Date.now() + 3_600_000),
    discard,
  }));

  function actAs(id: string, roles: string[]) {
    mocks.actor.mockImplementation(async () => ({
      userId: id,
      emailVerified: true,
      organizationId,
      roles,
    }));
  }

  async function seed() {
    const authSchema = await import("@/server/db/schema/auth");
    const documents = await import("@/server/db/schema/documents");
    await db.insert(authSchema.organizations).values({
      id: organizationId,
      name: "Test",
      slug: organizationId,
      createdAt: new Date(),
    });
    for (const [id, role, name] of [
      [userId, "owner", "Paula Prüferin"],
      [managerId, "admin", "Maria Manager"],
    ] as const) {
      await db
        .insert(authSchema.users)
        .values({ id, name, email: `${id}@example.invalid`, emailVerified: true });
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
        originalFilename: `anhang-${suffix}.docx`,
        sha256: suffix.padEnd(64, "e"),
        storageDriver: "vercel-blob",
        objectKey: `test/${suffix}/${randomUUID()}`,
        parserVersion: "test-parser",
        parseStatus: "parsing",
        originalDeleteAfter: new Date(Date.now() + 86_400_000),
        parsedDeleteAfter: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: documents.policyVersions.id });
    await db.insert(documents.documentBlocks).values(
      reportBlocks.map((text, index) => ({
        policyVersionId: version!.id,
        blockKey: `b${index + 1}`,
        ordinal: index + 1,
        blockType: index === 0 ? ("heading" as const) : ("paragraph" as const),
        canonicalText: text,
        pageNumber: 1,
        tokenCount: 20,
        textHash: `${index + 1}`.padEnd(64, "f"),
      })),
    );
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
      .values({ organizationId, ownerUserId: userId, title: "Anhang" })
      .returning({ id: schema.disclosureCases.id });
    await db.insert(schema.disclosureCaseDocuments).values({
      caseId: created!.id,
      role: "report",
      policyVersionId: version!.id,
      ordinal: 0,
      displayName: "anhang.docx",
    });
    return created!.id;
  }

  beforeAll(async () => {
    ({ db } = await import("@/server/db/client"));
    ({ eq, and, inArray } = await import("drizzle-orm"));
    schema = await import("@/server/db/schema/disclosure");
    completeness = await import("@/server/db/schema/disclosure-completeness");
    checklists = await import("./checklists");
    run = await import("./completeness-run");
    execute = await import("./execute-run");
    review = await import("./completeness-review");
    const { seedDemoChecklistTemplate } = await import("./checklist-store");
    ({ releaseId: templateReleaseId } = await seedDemoChecklistTemplate(db));
    actAs(userId, ["owner"]);
    caseId = await seed();
  });

  beforeEach(() => {
    mocks.launch.mockReset().mockResolvedValue({ runId: "wf" });
    mocks.deleteCredentials.mockReset().mockResolvedValue(0);
    mocks.model.mockReset().mockImplementation(modelAnswer);
    prepareModel.mockClear();
    discard.mockClear();
    actAs(userId, ["owner"]);
  });

  async function closeOpenRuns() {
    await db
      .update(schema.disclosureRuns)
      .set({ status: "cancelled" })
      .where(
        and(eq(schema.disclosureRuns.caseId, caseId), eq(schema.disclosureRuns.status, "queued")),
      );
  }

  async function snapshotTitles(runId: string) {
    const rows = await db
      .select({
        key: completeness.disclosureRunChecklistItems.externalKey,
        title: completeness.disclosureRunChecklistItems.title,
      })
      .from(completeness.disclosureRunChecklistItems)
      .where(eq(completeness.disclosureRunChecklistItems.runId, runId))
      .orderBy(completeness.disclosureRunChecklistItems.ordinal);
    return rows;
  }

  it("friert die Checkliste ein: spätere Änderungen an Vorlage und eigener Checkliste erreichen den Lauf nicht", async () => {
    const { checklistId } = await checklists.createChecklistFromTemplate({
      templateReleaseId,
      title: "Unsere HGB-Liste",
    });
    const fromChecklist = await run.startCompletenessRun(
      caseId,
      { source: { kind: "checklist", id: checklistId }, modelProfileId: "openrouter:test/model" },
      { prepareModel },
    );
    const before = await snapshotTitles(fromChecklist.runId);
    expect(before).toHaveLength(14);

    // Die eigene Checkliste ändert sich danach: neue Position, geänderter Titel.
    const view = await checklists.readChecklist(checklistId);
    const employees = view!.items.find((item) => item.externalKey === "HGB-285-7")!;
    await checklists.saveChecklistItem(checklistId, employees.id, {
      externalKey: "HGB-285-7",
      reference: "§ 285 Nr. 7 HGB",
      title: "Arbeitnehmer (geändert)",
      requirement: employees.requirement,
      aspects: employees.aspects.join("; "),
      parentId: null,
    });
    await checklists.saveChecklistItem(checklistId, null, {
      externalKey: "EIGEN-1",
      reference: "Hausregel 1",
      title: "Eigene Zusatzposition",
      requirement: "Der Anhang nennt den Sitz der Gesellschaft.",
      aspects: "",
      parentId: null,
    });
    expect(await snapshotTitles(fromChecklist.runId)).toEqual(before);
    await closeOpenRuns();

    // Ein Lauf direkt auf der Vorlage; danach ändert sich die Vorlagenposition.
    const fromTemplate = await run.startCompletenessRun(
      caseId,
      {
        source: { kind: "template", id: templateReleaseId },
        modelProfileId: "openrouter:test/model",
      },
      { prepareModel },
    );
    const templateBefore = await snapshotTitles(fromTemplate.runId);
    await db
      .update(completeness.disclosureChecklistTemplateItems)
      .set({ title: "Zahl der Arbeitnehmer (Vorlage geändert)" })
      .where(
        and(
          eq(completeness.disclosureChecklistTemplateItems.releaseId, templateReleaseId),
          eq(completeness.disclosureChecklistTemplateItems.externalKey, "HGB-285-7"),
        ),
      );
    expect(await snapshotTitles(fromTemplate.runId)).toEqual(templateBefore);
    await db
      .update(completeness.disclosureChecklistTemplateItems)
      .set({ title: "Zahl der Arbeitnehmer" })
      .where(
        and(
          eq(completeness.disclosureChecklistTemplateItems.releaseId, templateReleaseId),
          eq(completeness.disclosureChecklistTemplateItems.externalKey, "HGB-285-7"),
        ),
      );

    // Die eigene Checkliste zeigt ihre Herkunft; sie wurde nie mit der Vorlage zusammengeführt.
    const after = await checklists.readChecklist(checklistId);
    expect(after!.origin.releaseId).toBe(templateReleaseId);
    expect(after!.items.map((item) => item.title)).toContain("Eigene Zusatzposition");
    await closeOpenRuns();
  });

  it("startet bei gleichen Eingaben keinen zweiten Lauf und löscht den zweiten Schlüssel", async () => {
    const input = {
      source: { kind: "template" as const, id: templateReleaseId },
      modelProfileId: "openrouter:test/model",
    };
    const [first, second] = await Promise.all([
      run.startCompletenessRun(caseId, input, { prepareModel }),
      run.startCompletenessRun(caseId, input, { prepareModel }),
    ]);
    expect(first.runId).toBe(second.runId);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);
    expect(discard).toHaveBeenCalledTimes(1);
    // Ein zweiter Workflow-Start ist erlaubt, beansprucht aber keinen zweiten Lauf.
    expect(await execute.prepareDisclosureRun(first.runId, `wf-${randomUUID()}`)).toMatchObject({
      status: "running",
    });
    expect(await execute.prepareDisclosureRun(first.runId, `wf-${randomUUID()}`)).toEqual({
      status: "duplicate",
    });
    const runs = await db
      .select({ id: schema.disclosureRuns.id })
      .from(schema.disclosureRuns)
      .where(
        and(
          eq(schema.disclosureRuns.caseId, caseId),
          inArray(schema.disclosureRuns.status, ["queued", "running"]),
        ),
      );
    expect(runs).toHaveLength(1);
    await db
      .update(schema.disclosureRuns)
      .set({ status: "cancelled" })
      .where(eq(schema.disclosureRuns.id, first.runId));
  });

  async function runThrough() {
    const { runId } = await run.startCompletenessRun(
      caseId,
      {
        source: { kind: "template", id: templateReleaseId },
        modelProfileId: "openrouter:test/model",
      },
      { prepareModel },
    );
    await execute.prepareDisclosureRun(runId, `wf-${randomUUID()}`);
    for (const itemId of await run.openCompletenessItems(runId)) {
      await run.assessCompletenessItem(runId, itemId);
    }
    await run.finalizeCompletenessRun(runId);
    const results = await db
      .select({
        id: completeness.disclosureCompletenessResults.id,
        status: completeness.disclosureCompletenessResults.status,
        modelId: completeness.disclosureCompletenessResults.modelId,
        key: completeness.disclosureRunChecklistItems.externalKey,
      })
      .from(completeness.disclosureCompletenessResults)
      .innerJoin(
        completeness.disclosureRunChecklistItems,
        eq(
          completeness.disclosureRunChecklistItems.id,
          completeness.disclosureCompletenessResults.runItemId,
        ),
      )
      .where(eq(completeness.disclosureCompletenessResults.runId, runId));
    return { runId, results };
  }

  it("belegt mit exakten Zitaten, weist erfundene Zitate ab und fragt ohne Fundstelle kein Modell", async () => {
    const { runId, results } = await runThrough();
    const [finished] = await db
      .select({ status: schema.disclosureRuns.status })
      .from(schema.disclosureRuns)
      .where(eq(schema.disclosureRuns.id, runId));
    expect(finished!.status).toBe("completed");
    expect(results).toHaveLength(14);

    const employees = results.find((result) => result.key === "HGB-285-7")!;
    expect(employees.status).toBe("fulfilled");
    const [evidence] = await db
      .select()
      .from(completeness.disclosureCompletenessEvidence)
      .where(eq(completeness.disclosureCompletenessEvidence.resultId, employees.id));
    expect(evidence).toMatchObject({
      citationOrder: 1,
      exactQuote: "durchschnittlich 52 Arbeitnehmer beschäftigt",
    });
    expect(reportBlocks[1]).toContain(evidence!.exactQuote);

    // Das erfundene Zitat wird zweimal abgewiesen: keine Einschätzung, kein Beleg.
    const fee = results.find((result) => result.key === "HGB-285-17")!;
    expect(fee.status).toBe("no_assessment_possible");
    expect(
      await db
        .select()
        .from(completeness.disclosureCompletenessEvidence)
        .where(eq(completeness.disclosureCompletenessEvidence.resultId, fee.id)),
    ).toEqual([]);
    const feeCalls = mocks.model.mock.calls.filter(
      ([, request]) =>
        (JSON.parse((request as { user: string }).user) as { checklistItem: { title: string } })
          .checklistItem.title === "Honorar des Abschlussprüfers",
    );
    expect(feeCalls.length).toBeGreaterThanOrEqual(2);
    expect((feeCalls[1]![1] as { system: string }).system).toContain("rejected");

    // Positionen ohne Fundstelle werden ohne Modellaufruf als offen bewertet.
    const withoutModel = results.filter((result) => result.modelId === null);
    expect(withoutModel.length).toBeGreaterThan(0);
    expect(withoutModel.every((result) => result.status === "no_assessment_possible")).toBe(true);

    // Eine Wiederholung bewertet nichts doppelt.
    const calls = mocks.model.mock.calls.length;
    for (const result of results) {
      const [item] = await db
        .select({ id: completeness.disclosureCompletenessResults.runItemId })
        .from(completeness.disclosureCompletenessResults)
        .where(eq(completeness.disclosureCompletenessResults.id, result.id));
      await run.assessCompletenessItem(runId, item!.id);
    }
    expect(mocks.model.mock.calls.length).toBe(calls);
  });

  it("verlangt je Position zwei verschiedene Personen, und eine Ablehnung ist genau ein Ereignis", async () => {
    const { runId, results } = await runThrough();
    const employees = results.find((result) => result.key === "HGB-285-7")!;
    const fee = results.find((result) => result.key === "HGB-285-17")!;
    const eventsOf = (resultId: string) =>
      db
        .select()
        .from(completeness.disclosureCompletenessEvents)
        .where(eq(completeness.disclosureCompletenessEvents.resultId, resultId));

    // Stufe 1 durch die Prüferin; dieselbe Person darf nicht freigeben.
    expect(await review.reviewCompletenessResult(employees.id, { action: "confirm" })).toEqual({
      status: "prepared",
    });
    await expect(
      review.reviewCompletenessResult(employees.id, { action: "release" }),
    ).rejects.toMatchObject({ code: "DISCLOSURE_SAME_PERSON", status: 403 });
    const own = await review.readCompletenessReviews(runId);
    expect(own.reviews[employees.id]!.release).toBe("second_person_required");

    // Der Manager lehnt ab: genau ein Ereignis, kein Statuswechsel — dann gibt er frei.
    actAs(managerId, ["admin"]);
    const before = (await eventsOf(employees.id)).length;
    expect(
      await review.reviewCompletenessResult(employees.id, {
        action: "reject",
        comment: "Bitte Gruppen prüfen",
      }),
    ).toEqual({ status: "prepared" });
    const afterReject = await eventsOf(employees.id);
    expect(afterReject).toHaveLength(before + 1);
    expect(afterReject.filter((event) => event.kind === "rejected")).toHaveLength(1);
    expect((await review.readCompletenessReviews(runId)).reviews[employees.id]!.release).toBe(
      "allowed",
    );
    expect(await review.reviewCompletenessResult(employees.id, { action: "release" })).toEqual({
      status: "reviewed",
    });

    // Ein Override braucht eine Begründung und ersetzt den Status für die Anzeige.
    actAs(userId, ["owner"]);
    await expect(
      review.reviewCompletenessResult(fee.id, { action: "override", status: "not_applicable" }),
    ).rejects.toThrow();
    await review.reviewCompletenessResult(fee.id, {
      action: "override",
      status: "not_applicable",
      reason: "Befreiung nach § 285 Nr. 17 Halbsatz 2 HGB: Angabe im Konzernabschluss.",
    });
    const reviews = await review.readCompletenessReviews(runId);
    expect(reviews.reviews[fee.id]).toMatchObject({
      status: "prepared",
      override: { status: "not_applicable" },
    });
    expect(reviews.reviews[fee.id]!.history.map((entry) => entry.kind)).toEqual(["overridden"]);
  });

  it("importiert eine Excel-Vorlage als Entwurf, weist Fehler mit Zeile aus und veröffentlicht erst auf Anweisung", async () => {
    const { readFile } = await import("node:fs/promises");
    const ExcelJS = (await import("exceljs")).default;
    const templates = await import("./checklist-templates");
    mocks.administrator.mockResolvedValue({ userId, organizationId, roles: ["owner"] });

    // Die Beispieldatei aus assets/ ist gültig: Entwurf mit Vorschau, noch nicht wählbar.
    const example = new Uint8Array(
      await readFile("assets/samples/checklisten-vorlage-beispiel.xlsx"),
    );
    const first = await templates.createTemplateUploadIntent({
      filename: "beispiel.xlsx",
      byteSize: example.byteLength,
    });
    mocks.objects.set(first.upload.pathname, example);
    const imported = await templates.importTemplateDraft({
      uploadId: first.uploadId,
      filename: "beispiel.xlsx",
      title: `Import ${suffix}`,
    });
    expect(imported).toMatchObject({ ok: true, version: 1, itemCount: 14 });
    expect(mocks.objects.has(first.upload.pathname)).toBe(false);
    if (!imported.ok) throw new Error("unreachable");
    expect(await templates.readTemplateDraftPreview(imported.releaseId)).toHaveLength(14);
    const sources = await checklists.listChecklistSources();
    expect(sources.some((source) => source.id === imported.releaseId)).toBe(false);
    await templates.publishTemplateRelease(imported.releaseId);
    expect(
      (await checklists.listChecklistSources()).some((source) => source.id === imported.releaseId),
    ).toBe(true);

    // Eine fehlerhafte Datei: doppelter Schlüssel, leerer Titel, unbekannte Eltern.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Checkliste");
    sheet.addRow(["Schlüssel", "Referenz", "Titel", "Anforderung", "Prüfaspekte", "Übergeordnet"]);
    sheet.addRow(["A-1", "§ 1", "Titel", "Text.", "", ""]);
    sheet.addRow(["A-1", "§ 2", "Titel", "Text.", "", ""]);
    sheet.addRow(["A-2", "§ 3", "", "Text.", "", ""]);
    sheet.addRow(["A-3", "§ 4", "Titel", "Text.", "", "GIBT-ES-NICHT"]);
    const broken = new Uint8Array(await workbook.xlsx.writeBuffer());
    const second = await templates.createTemplateUploadIntent({
      filename: "kaputt.xlsx",
      byteSize: broken.byteLength,
    });
    mocks.objects.set(second.upload.pathname, broken);
    const rejected = await templates.importTemplateDraft({
      uploadId: second.uploadId,
      filename: "kaputt.xlsx",
      templateId: imported.templateId,
    });
    expect(rejected).toEqual({
      ok: false,
      issues: [
        { row: 3, key: "A-1", code: "duplicate_key" },
        { row: 4, key: "A-2", code: "empty_title" },
        { row: 5, key: "A-3", code: "unknown_parent" },
      ],
    });
    expect(mocks.objects.has(second.upload.pathname)).toBe(false);
  });
});
