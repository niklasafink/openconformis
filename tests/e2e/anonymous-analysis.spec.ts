import { expect, test, type Page } from "@playwright/test";

/**
 * Die App ist kein anonymer Trichter mehr: jede Route verlangt vorab eine
 * Sitzung (siehe `src/proxy.ts`). Ohne ein dediziertes Neon-Auth-Testprojekt
 * lässt sich das echte Registrierungsformular hier nicht gegen einen
 * gehosteten Anbieter durchspielen — dafür deckt `authentication.spec.ts`
 * Formular und Routing gegen den separaten, echt gegateten Server ab
 * (`chromium-gated` in `playwright.config.ts`). Dieses Projekt läuft
 * ausschließlich gegen den `chromium-bypass`-Server mit `LOCAL_AUTH_BYPASS=true`
 * und landet deshalb direkt auf dem Ziel.
 */
async function signUpAndLandOn(page: Page, target: string) {
  await page.goto(target);
}

test.describe("authenticated analysis setup", () => {
  test("moves from DORA to the persisted scope without an AI call", async ({ page }) => {
    await signUpAndLandOn(page, "/de/analyses/new/framework");

    await expect(
      page.getByRole("heading", { name: "Regulatorisches Rahmenwerk wählen" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /^DORA/ }).click();
    await expect(page.getByRole("link", { name: /^DORA/ })).toHaveAttribute("aria-current", "true");

    await page.getByRole("button", { name: "Weiter" }).click();
    await expect(page).toHaveURL(/\/de\/analyses\/new\/policy\?/u);
    await expect(page.getByRole("heading", { name: "Policy auswählen" })).toBeVisible();

    await page.getByRole("button", { name: "Auswählen", exact: true }).click();
    await expect(page).toHaveURL(/\/de\/analyses\/new\/scope\?/u);
    await expect(page.getByRole("heading", { name: "Prüfungsumfang und Kontext" })).toBeVisible();
    await expect(page.locator(".scope-count")).toContainText("10/10 einschlägig");
    await expect(page.getByText("Art. 5 Abs. 2 DORA", { exact: true }).first()).toBeVisible();
  });

  test("keeps unavailable frameworks locked and searchable", async ({ page }) => {
    await signUpAndLandOn(page, "/de/analyses/new/framework");

    const lockedFramework = page.getByRole("row").filter({ hasText: "ISO 27001" });
    await expect(lockedFramework).toHaveAttribute("aria-disabled", "true");

    await page.getByRole("searchbox", { name: "Rahmenwerke durchsuchen" }).fill("ISO 27001");
    await page.getByRole("searchbox", { name: "Rahmenwerke durchsuchen" }).press("Enter");
    await expect(page).toHaveURL(/q=ISO(?:\+|%20)27001/u);
    await expect(lockedFramework).toBeVisible();
    await expect(page.getByRole("link", { name: /^DORA/ })).toHaveCount(0);
  });

  test("allows the embedded sample policy in an independent authenticated draft", async ({
    page,
  }) => {
    await signUpAndLandOn(page, "/de/analyses/new/framework?framework=dora");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("button", { name: "Auswählen", exact: true }).click();

    await expect(page).toHaveURL(/\/de\/analyses\/new\/scope\?/u);
    await expect(page.getByRole("heading", { name: "Prüfungsumfang und Kontext" })).toBeVisible();
  });

  test("shows the locked result at once and connects the key from the header", async ({ page }) => {
    // Wer die Ergebnis-Vorschau erreicht, ist bereits angemeldet (die App lässt
    // niemanden anders bis hierhin). Zwischen Prüfungsumfang und Ergebnis liegt
    // nichts mehr: kein Ladeschritt, kein Dialog — der eigene Modellzugang sitzt
    // in der Kopfzeile.
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await signUpAndLandOn(page, "/de/analyses/new/framework?framework=dora");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("button", { name: "Auswählen", exact: true }).click();
    const unevaluatedWarning = page.locator(".scope-model-warning input");
    await expect(unevaluatedWarning).toBeVisible();
    await unevaluatedWarning.check();
    await page.getByRole("button", { name: "Umfang bestätigen" }).click();

    await expect(page).toHaveURL(/\/de\/analyses\/new\/results\?/u);
    // Das Ergebnis steht sofort, ohne dass eine Überlagerung es verdeckt.
    await expect(page.getByRole("button", { name: /Art\. 5 Abs\. 4 DORA/u })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Ohne verbundenen Schlüssel meldet das Zugangsfeld rot und die Analyse
    // lässt sich nicht starten.
    // Der Knopf trägt den Modellnamen; stabil ansprechbar ist er über den Titel.
    const accessPanel = page.getByTitle("Modellzugang");
    await expect(accessPanel).toBeVisible();
    await accessPanel.click();
    await expect(page.getByText("Kein Schlüssel hinterlegt")).toBeVisible();
    await expect(page.getByLabel(/API-Key$/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyse starten" })).toBeDisabled();
    await expect(page.getByRole("combobox")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Art\. 5 Abs\. 4 DORA/u }).click();
    await expect(
      page.getByRole("heading", { name: "Schulung des Leitungsorgans zu IKT-Risiken" }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("serves the English workflow and production security headers", async ({ page }) => {
    await signUpAndLandOn(page, "/en/analyses/new/framework");
    const response = await page.goto("/en/analyses/new/framework");

    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await expect(page.getByRole("heading", { name: "Select regulatory framework" })).toBeVisible();
    // Die Sidebar trägt zusätzlich die Aktion „New chat"; nur der Bereichslink zählt.
    await expect(page.getByRole("link", { name: "Assistant", exact: true })).toBeVisible();
  });
});

test("reports database readiness without requiring a worker in E2E", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    database: "reachable",
  });
});
