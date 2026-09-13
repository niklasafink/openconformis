// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { SessionPrincipal } from "@/server/auth/session-principal";

import { canConfirmAssessment, canOverrideAssessment, nextResolvedTodos } from "./review-analysis";

function principal(
  roles: SessionPrincipal["roles"],
  emailVerified = true,
): Pick<SessionPrincipal, "roles" | "emailVerified"> {
  return { roles, emailVerified };
}

describe("analysis result confirmation permission", () => {
  it("allows owner, admin and reviewer roles", () => {
    expect(canConfirmAssessment(principal(["owner"]))).toBe(true);
    expect(canConfirmAssessment(principal(["admin"]))).toBe(true);
    expect(canConfirmAssessment(principal(["reviewer"]))).toBe(true);
  });

  it("does not let analysts or viewers confirm assessments", () => {
    expect(canConfirmAssessment(principal(["analyst"]))).toBe(false);
    expect(canConfirmAssessment(principal(["viewer"]))).toBe(false);
  });

  it("requires a verified email even for a privileged role", () => {
    expect(canConfirmAssessment(principal(["owner"], false))).toBe(false);
  });
});

describe("analysis result override permission", () => {
  it("allows reviewers and analysts but not viewers", () => {
    expect(canOverrideAssessment(principal(["owner"]))).toBe(true);
    expect(canOverrideAssessment(principal(["admin"]))).toBe(true);
    expect(canOverrideAssessment(principal(["analyst"]))).toBe(true);
    expect(canOverrideAssessment(principal(["reviewer"]))).toBe(true);
    expect(canOverrideAssessment(principal(["viewer"]))).toBe(false);
  });

  it("requires a verified email", () => {
    expect(canOverrideAssessment(principal(["reviewer"], false))).toBe(false);
  });
});

describe("resolved to-do positions", () => {
  it("adds a position once and keeps the list sorted", () => {
    expect(nextResolvedTodos([2], 0, true)).toEqual([0, 2]);
    expect(nextResolvedTodos([0, 2], 2, true)).toEqual([0, 2]);
  });

  it("reopens a position without touching the others", () => {
    expect(nextResolvedTodos([0, 2], 0, false)).toEqual([2]);
    expect(nextResolvedTodos([2], 1, false)).toEqual([2]);
  });
});
