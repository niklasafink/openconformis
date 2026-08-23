import { expect, test } from "@playwright/test";

const draftId = "00000000-0000-0000-0000-000000000000";
const verifier = "neon_auth_session_verifier=expired-token";

/**
 * Diese Fälle waren die Ursache dafür, dass der Anmeldeprozess unbenutzbar war,
 * während die übrige Suite grün blieb: jeder Fehlerpfad des Anmeldelinks endete
 * auf einer 404-Seite. Sie prüfen bewusst nur Routing und Fehlerführung — ein
 * echter Verifier lässt sich ohne Provider nicht erzeugen.
 */
test.describe("authentication routing", () => {
  test("gives the application an entry point", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/de\/analyses\/new\/framework$/);

    const german = await page.goto("/de");
    expect(german?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/analyses\/new\/framework$/);

    const english = await page.goto("/en");
    expect(english?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/en\/analyses\/new\/framework$/);
  });

  test("serves a standalone sign-in page in both locales", async ({ page }) => {
    await page.goto("/de/sign-in");
    await expect(
      page.getByRole("heading", { name: "Anmelden oder Konto erstellen" }),
    ).toBeVisible();
    await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
    await expect(page.getByRole("button", { name: "Anmeldelink senden" })).toBeVisible();

    await page.goto("/en/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in or create an account" })).toBeVisible();
  });

  test("explains a sign-in link opened in another browser instead of a 404", async ({ page }) => {
    const response = await page.goto(`/de/analyses/new/results?draft=${draftId}&${verifier}`);

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/sign-in\?auth_error=magic_link_browser_mismatch$/);
    // Nicht über die Rolle suchen: der Route-Announcer von Next.js trägt
    // ebenfalls role="alert" und bricht die Strict-Mode-Auflösung.
    await expect(page.locator("p.auth-notice")).toContainText("anderen Browser");
  });

  test("sends an unbound preview visitor to sign-in rather than a dead end", async ({ page }) => {
    const response = await page.goto(`/de/analyses/new/results?draft=${draftId}`);

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/sign-in/);
  });

  test("keeps an off-site redirect target out of the sign-in flow", async ({ page }) => {
    await page.goto("/de/sign-in?next=https%3A%2F%2Fevil.example%2Fx");
    await expect(
      page.getByRole("heading", { name: "Anmelden oder Konto erstellen" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/127\.0\.0\.1|localhost/);
  });
});
