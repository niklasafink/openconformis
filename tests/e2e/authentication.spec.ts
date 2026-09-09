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
  test("sends an unauthenticated visitor to sign-in before any app step", async ({ page }) => {
    // Die App ist kein anonymer Trichter mehr: jede Route landet vor der ersten
    // Interaktion auf der Anmeldefläche, mit `next` als Rücksprungziel.
    await page.goto("/");
    await expect(page).toHaveURL(/\/de\/sign-in\?next=/);

    const german = await page.goto("/de");
    expect(german?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/sign-in\?next=/);

    const english = await page.goto("/en");
    expect(english?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/en\/sign-in\?next=/);

    const framework = await page.goto("/de/analyses/new/framework");
    expect(framework?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/sign-in\?next=%2Fde%2Fanalyses%2Fnew%2Fframework/);
  });

  test("serves a standalone sign-in page in both locales", async ({ page }) => {
    await page.goto("/de/sign-in");
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    await expect(page.getByLabel("E-Mail-Adresse")).toBeVisible();
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();

    await page.goto("/en/sign-in");
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  test("serves a standalone sign-up page linked from sign-in", async ({ page }) => {
    await page.goto("/de/sign-in");
    await page.getByRole("link", { name: "Registrieren" }).click();
    await expect(page).toHaveURL(/\/de\/sign-up/);
    await expect(page.getByRole("heading", { name: "Konto erstellen" })).toBeVisible();
    await expect(page.getByLabel("Passwort bestätigen")).toBeVisible();
  });

  test("explains a spent sign-in link instead of a 404", async ({ page }) => {
    // Ein Anmeldelink setzt beim Anfordern keinen Cookie — die Bibliothek nutzt
    // den Challenge-Cookie nur für OAuth. Ein abgelaufener oder erfundener
    // Verifier muss deshalb an der Bibliothek scheitern und auf der
    // Anmeldefläche erklärt werden, nicht vorab pauschal blockiert.
    const response = await page.goto(`/de/analyses/new/results?draft=${draftId}&${verifier}`);

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/sign-in\?auth_error=magic_link_invalid/);
    // `getByRole("alert")` allein trifft auch den leeren Next.js-Routen-
    // Announcer; `filter` grenzt auf das eigene Fehlerbanner ein.
    await expect(page.getByRole("alert").filter({ hasText: "abgelaufen" })).toBeVisible();
  });

  test("sends an unbound preview visitor to sign-in rather than a dead end", async ({ page }) => {
    const response = await page.goto(`/de/analyses/new/results?draft=${draftId}`);

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(/\/de\/sign-in/);
  });

  test("keeps an off-site redirect target out of the sign-in flow", async ({ page }) => {
    await page.goto("/de/sign-in?next=https%3A%2F%2Fevil.example%2Fx");
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
    await expect(page).toHaveURL(/127\.0\.0\.1|localhost/);
  });

  test("keeps sign-up, password recovery and the legal pages reachable without a session", async ({
    page,
  }) => {
    for (const path of ["/de/sign-up", "/de/forgot-password", "/de/terms", "/de/privacy"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    }
  });

  test("submits the forgot-password form and resolves to a clear state", async ({ page }) => {
    // Der tatsächliche Mailversand ist Sache des gehosteten Neon-Auth-Projekts
    // (`emailAndPassword.sendResetPassword`) und liegt außerhalb dieses Repos.
    // Dieser Test sichert nur den UI-Pfad — der Aufruf erreicht `authClient.
    // requestPasswordReset` und die Seite bleibt in einem klaren Zustand, egal
    // ob der Anbieter den Versand bereits konfiguriert hat.
    await page.goto("/de/forgot-password");
    await page.getByLabel("E-Mail-Adresse").fill("no-such-account@openconformis.invalid");
    await page.getByRole("button", { name: "Link senden" }).click();
    await expect(
      page.getByText(/wurde ein Link|Die Anmeldung konnte nicht abgeschlossen werden/),
    ).toBeVisible();
  });
});
