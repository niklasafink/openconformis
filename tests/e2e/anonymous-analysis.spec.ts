import { expect, test } from "@playwright/test";

test.describe("anonymous analysis setup", () => {
  test("moves from DORA to the persisted scope without an AI call", async ({ page }) => {
    await page.goto("/de/analyses/new/framework");

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
    await page.goto("/de/analyses/new/framework");

    const lockedFramework = page.locator('.framework-card[data-locked="true"]', {
      hasText: "ISO 27001",
    });
    await expect(lockedFramework).toHaveAttribute("aria-disabled", "true");

    await page.getByRole("searchbox", { name: "Rahmenwerke durchsuchen" }).fill("ISO 27001");
    await page.getByRole("searchbox", { name: "Rahmenwerke durchsuchen" }).press("Enter");
    await expect(page).toHaveURL(/q=ISO(?:\+|%20)27001/u);
    await expect(lockedFramework).toBeVisible();
    await expect(page.getByRole("link", { name: /^DORA/ })).toHaveCount(0);
  });

  test("allows the embedded sample policy in an independent anonymous draft", async ({ page }) => {
    await page.goto("/de/analyses/new/framework?framework=dora");
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("button", { name: "Auswählen", exact: true }).click();

    await expect(page).toHaveURL(/\/de\/analyses\/new\/scope\?/u);
    await expect(page.getByRole("heading", { name: "Prüfungsumfang und Kontext" })).toBeVisible();
  });

  test("serves the English workflow and production security headers", async ({ page }) => {
    const response = await page.goto("/en/analyses/new/framework");

    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await expect(page.getByRole("heading", { name: "Select regulatory framework" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
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
