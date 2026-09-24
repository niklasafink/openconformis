// @vitest-environment node

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  isAuthenticationConfigured: true,
  auth: { middleware: () => mocks.gate },
}));

import proxy from "./proxy";

const scopeUrl =
  "https://localhost:3001/de/analyses/new/scope?draft=46f91fae-a001-46a5-b492-764ab97fd364";

function scopeRequest(cookie: string) {
  return new NextRequest(scopeUrl, { headers: { cookie } });
}

/** Die Cookies, die die weitergereichte Anfrage im App Router trägt. */
function forwardedCookie(response: NextResponse) {
  return response.headers.get("x-middleware-request-cookie");
}

beforeEach(() => {
  mocks.gate.mockReset();
});

describe("Sitzungsprüfung vor jeder Seite", () => {
  it("reicht ein aufgefrischtes Sitzungscookie an dieselbe Anfrage weiter", async () => {
    mocks.gate.mockImplementation(async () => {
      const allowed = NextResponse.next();
      allowed.headers.append(
        "set-cookie",
        "neon_auth_session_data=frisch.signiert.jwt; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=300",
      );
      return allowed;
    });

    const response = await proxy(
      scopeRequest("neon_auth_session_token=gueltig; neon_auth_session_data=abgelaufen"),
    );

    expect(forwardedCookie(response)).toBe(
      "neon_auth_session_token=gueltig; neon_auth_session_data=frisch.signiert.jwt",
    );
    // Der Browser braucht dasselbe Cookie für die nächste Anfrage.
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringContaining("neon_auth_session_data=frisch.signiert.jwt"),
    );
    expect(response.headers.get("location")).toBeNull();
  });

  it("lässt die Cookies unverändert, wenn das Gate keine auffrischt", async () => {
    mocks.gate.mockResolvedValue(NextResponse.next());

    const response = await proxy(scopeRequest("neon_auth_session_token=gueltig"));

    expect(forwardedCookie(response)).toBe("neon_auth_session_token=gueltig");
  });

  it("leitet ohne Sitzung auf die Anmeldung und nimmt das Ziel mit", async () => {
    mocks.gate.mockResolvedValue(NextResponse.redirect("https://localhost:3001/de/sign-in"));

    const response = await proxy(scopeRequest("sidebar_state=true"));

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/de/sign-in");
    expect(location.searchParams.get("next")).toBe(
      "/de/analyses/new/scope?draft=46f91fae-a001-46a5-b492-764ab97fd364",
    );
  });

  it("schickt niemanden zur Anmeldung, nur weil der Auth-Dienst gerade wirft", async () => {
    mocks.gate.mockRejectedValue(new Error("upstream unreachable"));

    const response = await proxy(scopeRequest("neon_auth_session_token=gueltig"));

    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/de/sign-in");
  });
});
