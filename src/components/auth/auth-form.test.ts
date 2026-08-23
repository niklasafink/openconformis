import { describe, expect, it } from "vitest";

import { classifyAuthFailure } from "./auth-form";

/**
 * Die Fälle unten sind echte Antworten von Neon Auth, mitgeschnitten im Browser.
 * Der Client wirft `AuthApiError` mit einem groben `code` ("validation_failed");
 * der Grund steht nur in der englischen Meldung. Diese Abhängigkeit ist fragil,
 * deshalb ist sie hier festgehalten: ändert der Anbieter seine Formulierung,
 * schlägt der Test fehl, statt dass der Nutzer wieder in einer generischen
 * Fehlermeldung landet.
 */
describe("classifyAuthFailure", () => {
  it("recognizes an existing account from the thrown provider error", () => {
    expect(
      classifyAuthFailure({
        __isAuthError: true,
        name: "AuthApiError",
        status: 422,
        code: "validation_failed",
        message: "User already exists. Use another email.",
      }),
    ).toBe("accountExists");
  });

  it("recognizes an existing account from a structured error code", () => {
    expect(classifyAuthFailure({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe(
      "accountExists",
    );
  });

  it("recognizes wrong credentials", () => {
    expect(classifyAuthFailure({ status: 401, message: "Invalid email or password" })).toBe(
      "invalidCredentials",
    );
    expect(classifyAuthFailure({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("invalidCredentials");
    expect(classifyAuthFailure({ status: 401 })).toBe("invalidCredentials");
  });

  it("recognizes a password that does not meet the length rules", () => {
    expect(classifyAuthFailure({ message: "Password too short" })).toBe("passwordTooShort");
    expect(classifyAuthFailure({ message: "Password must be at least 8 characters" })).toBe(
      "passwordTooShort",
    );
  });

  it("recognizes rate limiting", () => {
    expect(classifyAuthFailure({ status: 429 })).toBe("tooManyAttempts");
    expect(classifyAuthFailure({ message: "Too many requests" })).toBe("tooManyAttempts");
  });

  it("falls back to the generic case for anything unrecognized", () => {
    expect(classifyAuthFailure({ status: 500, message: "Internal error" })).toBe("generic");
    expect(classifyAuthFailure(new Error("network down"))).toBe("generic");
    expect(classifyAuthFailure(undefined)).toBe("generic");
    expect(classifyAuthFailure(null)).toBe("generic");
  });
});
