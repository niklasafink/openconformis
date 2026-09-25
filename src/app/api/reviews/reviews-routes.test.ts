// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  head: vi.fn(),
  delta: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  override: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@/server/review/read-review", () => ({
  getReviewRunHead: mocks.head,
  getReviewCellDelta: mocks.delta,
  getReviewCellDetail: vi.fn(),
  defaultDeltaLimit: 300,
}));
vi.mock("@/server/review/start-review", async () => {
  const original = await vi
    .importActual<typeof import("@/server/review/start-review")>("@/server/review/start-review")
    .catch(() => undefined);
  class ReviewStartError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { ...original, ReviewStartError, startReview: mocks.start };
});
vi.mock("@/server/review/cancel-review", () => ({ cancelReviewRun: mocks.cancel }));
vi.mock("@/server/review/review-actions", async () => {
  const { z } = await import("zod");
  return {
    setReviewCellOverride: mocks.override,
    setReviewCellConfirmation: mocks.confirm,
    reviewCellOverrideAnswerSchema: z.union([
      z.object({ boolean: z.boolean() }).strict(),
      z.object({ choice: z.string() }).strict(),
      z.object({ scoreLevel: z.number().int() }).strict(),
    ]),
  };
});
vi.mock("@/server/security/request-protection", () => ({
  assertRequestSize: vi.fn(),
  enforceRequestRateLimit: vi.fn(async () => undefined),
  requestProtectionResponse: () => undefined,
}));
vi.mock("@/server/review/review-actor", () => ({
  ReviewAccessError: class ReviewAccessError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
  resolveReviewActor: vi.fn(),
}));
vi.mock("@/server/ai/credential-error-response", () => ({
  credentialErrorResponse: () => Response.json({ code: "CREDENTIAL" }, { status: 422 }),
}));

const runId = "0b3e1a4e-8f2f-4f7a-9c53-3b6f0c9d3f11";
const cellId = "7d1c9d1e-0a55-4c53-8a3a-5d3c1e1a6b22";
const trustedHeaders = { origin: "http://localhost:3000", "content-type": "application/json" };

function head(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    status: "running",
    headSeq: 42,
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("review head route", () => {
  // Der erste Import der Route ist kalt und dauert unter Volllast länger als ein Test.
  beforeAll(async () => {
    await import("./[reviewRunId]/route");
  }, 30_000);
  beforeEach(() => vi.resetAllMocks());

  it("answers 304 when neither the change sequence nor the run changed", async () => {
    const { GET } = await import("./[reviewRunId]/route");
    mocks.head.mockResolvedValue(head());
    const first = await GET(new Request("http://localhost/api/reviews/x"), {
      params: Promise.resolve({ reviewRunId: runId }),
    });
    const etag = first.headers.get("etag")!;
    expect(first.status).toBe(200);
    expect(etag).toMatch(/^W\/"42-/u);

    const second = await GET(
      new Request("http://localhost/api/reviews/x", { headers: { "if-none-match": etag } }),
      { params: Promise.resolve({ reviewRunId: runId }) },
    );
    expect(second.status).toBe(304);
  });

  it("does not hide a status change that touched no cell", async () => {
    const { GET } = await import("./[reviewRunId]/route");
    mocks.head.mockResolvedValue(head());
    const before = await GET(new Request("http://localhost/api/reviews/x"), {
      params: Promise.resolve({ reviewRunId: runId }),
    });
    // Der Lauf ist fertig, aber keine Zelle hat sich seit dem letzten Abruf geändert.
    mocks.head.mockResolvedValue(
      head({ status: "completed", updatedAt: "2026-09-20T10:05:00.000Z" }),
    );
    const after = await GET(
      new Request("http://localhost/api/reviews/x", {
        headers: { "if-none-match": before.headers.get("etag")! },
      }),
      { params: Promise.resolve({ reviewRunId: runId }) },
    );
    expect(after.status).toBe(200);
    expect((await after.json()).status).toBe("completed");
  });

  it("returns 404 for an unknown run and 400 for a malformed id", async () => {
    const { GET } = await import("./[reviewRunId]/route");
    mocks.head.mockResolvedValue(undefined);
    expect(
      (
        await GET(new Request("http://localhost/x"), {
          params: Promise.resolve({ reviewRunId: runId }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await GET(new Request("http://localhost/x"), {
          params: Promise.resolve({ reviewRunId: "nicht-uuid" }),
        })
      ).status,
    ).toBe(400);
  });
});

describe("review cells route", () => {
  beforeEach(() => vi.resetAllMocks());

  it("passes since and limit through and refuses a negative cursor", async () => {
    const { GET } = await import("./[reviewRunId]/cells/route");
    mocks.delta.mockResolvedValue({ cells: [], nextSince: 7, hasMore: false });
    const ok = await GET(new Request("http://localhost/x?since=7&limit=120"), {
      params: Promise.resolve({ reviewRunId: runId }),
    });
    expect(ok.status).toBe(200);
    expect(mocks.delta).toHaveBeenCalledWith({ reviewRunId: runId, since: 7, limit: 120 });
    const bad = await GET(new Request("http://localhost/x?since=-1"), {
      params: Promise.resolve({ reviewRunId: runId }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("mutating review routes", () => {
  beforeEach(() => vi.resetAllMocks());

  it("refuse an untrusted origin before doing anything", async () => {
    const start = await import("./start/route");
    const cancel = await import("./[reviewRunId]/cancel/route");
    const override = await import("./[reviewRunId]/cells/[cellId]/override/route");
    const confirmation = await import("./[reviewRunId]/cells/[cellId]/confirmation/route");
    const hostile = { origin: "https://evil.example", "content-type": "application/json" };
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    const responses = await Promise.all([
      start.POST(
        new Request("http://localhost/x", { method: "POST", headers: hostile, body: "{}" }),
      ),
      cancel.POST(new Request("http://localhost/x", { method: "POST", headers: hostile }), {
        params: Promise.resolve({ reviewRunId: runId }),
      }),
      override.PUT(
        new Request("http://localhost/x", { method: "PUT", headers: hostile, body: "{}" }),
        {
          params: Promise.resolve({ reviewRunId: runId, cellId }),
        },
      ),
      confirmation.PUT(
        new Request("http://localhost/x", { method: "PUT", headers: hostile, body: "{}" }),
        { params: Promise.resolve({ reviewRunId: runId, cellId }) },
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.override).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("reports a missing TypeSafe key as its own code and never echoes the key", async () => {
    const { POST } = await import("./start/route");
    const { ReviewStartError } = await import("@/server/review/start-review");
    mocks.start.mockRejectedValue(new ReviewStartError("REVIEW_TYPESAFE_KEY_REQUIRED"));

    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        headers: trustedHeaders,
        body: JSON.stringify({
          reviewTableId: runId,
          modelProfileId: "openrouter:x",
          modelCatalogueVersion: "v",
        }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "REVIEW_TYPESAFE_KEY_REQUIRED" });
  });

  it("answers 202 for a new run and 200 for a taken-over one", async () => {
    const { POST } = await import("./start/route");
    const request = () =>
      new Request("http://localhost/x", {
        method: "POST",
        headers: trustedHeaders,
        body: JSON.stringify({
          reviewTableId: runId,
          modelProfileId: "openrouter:x",
          modelCatalogueVersion: "v",
        }),
      });
    mocks.start.mockResolvedValueOnce({ reviewRunId: runId, status: "queued", reused: false });
    expect((await POST(request())).status).toBe(202);
    mocks.start.mockResolvedValueOnce({ reviewRunId: runId, status: "running", reused: true });
    expect((await POST(request())).status).toBe(200);
  });

  it("rejects an override body that carries two answers or no reason", async () => {
    const { PUT } = await import("./[reviewRunId]/cells/[cellId]/override/route");
    const call = (body: unknown) =>
      PUT(
        new Request("http://localhost/x", {
          method: "PUT",
          headers: trustedHeaders,
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ reviewRunId: runId, cellId }) },
      );
    expect(
      (await call({ answer: { boolean: true, choice: "de" }, reason: "Begründung ist da." }))
        .status,
    ).toBe(400);
    expect((await call({ answer: { boolean: true }, reason: "kurz" })).status).toBe(400);
    expect(mocks.override).not.toHaveBeenCalled();
  });
});
