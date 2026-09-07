import { describe, expect, it } from "vitest";

import { describeStartFailure } from "./start-failure-messages";

/**
 * Jeder Code, den der Start-Endpunkt ausgeben kann, muss einen Satz haben.
 * Fehlt einer, sieht der Nutzer wieder nur „Die Analyse konnte nicht gestartet
 * werden" — genau der Zustand, den diese Zuordnung beseitigen soll.
 */
const codesTheRouteCanReturn = [
  "DATABASE_UNAVAILABLE",
  "DRAFT_NOT_FOUND",
  "DRAFT_NOT_ACTIVE",
  "DRAFT_ALREADY_CLAIMED",
  "FRAMEWORK_RELEASE_NOT_FOUND",
  "SCOPE_RELEASE_MISMATCH",
  "SCOPE_INVALID",
  "POLICY_NOT_READY",
  "MODEL_SELECTION_NOT_FOUND",
  "BYOK_CREDENTIAL_INVALID",
  "BYOK_ROUTE_NOT_EXECUTABLE",
  "BYOK_PRIVACY_ATTESTATION_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "VERIFIED_EMAIL_REQUIRED",
  "MEMBERSHIP_REQUIRED",
  "UNTRUSTED_ORIGIN",
  "INVALID_ANALYSIS_START",
  "ANALYSIS_START_FAILED",
];

describe("describeStartFailure", () => {
  it("explains every failure the start endpoint can return", () => {
    for (const code of codesTheRouteCanReturn) {
      const message = describeStartFailure(code);
      expect(message, `kein Text für ${code}`).toBeTruthy();
      expect(message!.length).toBeGreaterThan(20);
    }
  });

  it("names the next step for the cases a user can resolve", () => {
    expect(describeStartFailure("BYOK_CREDENTIAL_INVALID")).toContain("erneut");
    expect(describeStartFailure("AUTHENTICATION_REQUIRED")).toContain("melden Sie sich erneut an");
    expect(describeStartFailure("DRAFT_NOT_ACTIVE")).toContain("Rahmenwerkauswahl");
  });

  it("returns nothing for an unknown code rather than inventing an explanation", () => {
    expect(describeStartFailure("SOMETHING_ELSE")).toBeUndefined();
  });
});
