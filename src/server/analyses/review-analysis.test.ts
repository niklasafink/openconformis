// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { SessionPrincipal } from "@/server/auth/session-principal";

import { canConfirmAssessment, canOverrideAssessment } from "./review-analysis";

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
