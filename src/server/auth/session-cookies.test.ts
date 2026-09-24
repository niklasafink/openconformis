// @vitest-environment node

import { describe, expect, it } from "vitest";

import { mergeRefreshedCookieHeader } from "./session-cookies";

const now = new Date("2026-09-24T12:00:00.000Z");

describe("aufgefrischte Sitzungscookies", () => {
  it("ersetzt den Wert eines erneuerten Cookies und behält die übrigen", () => {
    const merged = mergeRefreshedCookieHeader(
      "neon_auth_session_token=alt; sidebar_state=true",
      [
        "neon_auth_session_token=neu; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800",
        "neon_auth_session_data=signiert.jwt.wert; Path=/; HttpOnly; Secure; Max-Age=300",
      ],
      now,
    );

    expect(merged).toBe(
      "neon_auth_session_token=neu; sidebar_state=true; neon_auth_session_data=signiert.jwt.wert",
    );
  });

  it("entfernt ein Cookie, das der Auth-Dienst löscht", () => {
    const merged = mergeRefreshedCookieHeader(
      "neon_auth_session_data=abgelaufen; sidebar_state=true",
      ["neon_auth_session_data=; Path=/; HttpOnly; Secure; Max-Age=0"],
      now,
    );

    expect(merged).toBe("sidebar_state=true");
  });

  it("wertet ein vergangenes Ablaufdatum als Löschung", () => {
    const merged = mergeRefreshedCookieHeader(
      "neon_auth_session_token=alt",
      ["neon_auth_session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"],
      now,
    );

    expect(merged).toBe("");
  });

  it("lässt ein Cookie stehen, dessen Max-Age den vergangenen Expires-Wert überstimmt", () => {
    const merged = mergeRefreshedCookieHeader(
      "neon_auth_session_token=alt",
      ["neon_auth_session_token=neu; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=600"],
      now,
    );

    expect(merged).toBe("neon_auth_session_token=neu");
  });

  it("lässt Werte unangetastet, statt sie zu dekodieren und neu zu kodieren", () => {
    const merged = mergeRefreshedCookieHeader(
      "",
      ["neon_auth_session_token=a%2Fb.c%3D; Path=/; Secure"],
      now,
    );

    expect(merged).toBe("neon_auth_session_token=a%2Fb.c%3D");
  });

  it("übergeht Header ohne Namen, statt einen leeren Eintrag zu erzeugen", () => {
    const merged = mergeRefreshedCookieHeader("sidebar_state=true", ["=wertlos; Path=/"], now);

    expect(merged).toBe("sidebar_state=true");
  });
});
