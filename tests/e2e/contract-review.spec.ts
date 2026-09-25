import { expect, test, type Page } from "@playwright/test";

import { seedFinishedReviewRun } from "./review-seed";

/**
 * Die Vertragsprüfung im Browser, gegen den `chromium-bypass`-Server mit
 * `LOCAL_AUTH_BYPASS=true` und ohne einen einzigen KI-Aufruf: Prüfung anlegen,
 * Beispieldokument hinzufügen, eine Frage links eintippen und eine Spalte über
 * den Dialog anlegen, den gesperrten Start prüfen, dann einen fertigen Lauf
 * direkt in die Testdatenbank schreiben und Zelle, Beleg und Export im Browser
 * prüfen. Es wird kein Anbieter gerufen.
 */

async function createReview(page: Page, name: string) {
  await page.goto("/de/reviews");
  await expect(page.getByRole("heading", { name: "Vertragsprüfung" })).toBeVisible();
  await page.getByLabel("Name der Prüfung").fill(name);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page).toHaveURL(/\/de\/reviews\/[0-9a-f-]{36}$/u);
  return /\/reviews\/([0-9a-f-]{36})$/u.exec(page.url())![1]!;
}

async function addColumn(
  page: Page,
  input: { label: string; type?: "Auswahl"; instructions: string; criteria: string[][] },
) {
  await page.getByRole("button", { name: "Neue Spalte" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Neue Spalte" })).toBeVisible();
  await dialog.getByLabel("Bezeichnung", { exact: true }).fill(input.label);
  if (input.type) {
    await dialog.getByLabel("Typ").click();
    await page.getByRole("option", { name: input.type }).click();
  }
  await dialog.getByLabel("Frage an das Modell (englisch)").fill(input.instructions);
  const labels = dialog.getByLabel("Bezeichnung im Ergebnis");
  const descriptions = dialog.getByLabel("Beschreibung (englisch)");
  for (const [index, [label, description]] of input.criteria.entries()) {
    await labels.nth(index).fill(label!);
    await descriptions.nth(index).fill(description!);
  }
  await dialog.getByRole("button", { name: "Speichern" }).click();
  // Speichern lädt die Serverdaten nach; der Entwicklungsserver kompiliert dabei nach.
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByRole("rowheader", { name: new RegExp(input.label, "u") })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("contract review", () => {
  test("builds a review, locks the start without an API key and shows a seeded cell with evidence", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    const reviewTableId = await createReview(page, "Lieferantenverträge 2026");
    // Der Sidebar-Punkt ist aktiv, ohne Unterpunkte.
    await expect(page.getByRole("link", { name: "Vertragsprüfung", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Noch keine Dokumente in dieser Prüfung.")).toBeVisible();

    // Beispieldokument über denselben Weg wie ein Upload: es wird Spalte B.
    await page.getByRole("button", { name: "Beispieldokument hinzufügen" }).click();
    await expect(
      page.getByRole("columnheader", { name: /Beispiel-IKT-Sicherheitsrichtlinie/u }),
    ).toBeVisible({ timeout: 15_000 });

    // Eine Frage entsteht links in Spalte A: Enter beendet sie und öffnet die nächste.
    const composer = page.getByRole("textbox", { name: "Frage anlegen" });
    await composer.fill("Enthält der Vertrag eine Kündigung aus wichtigem Grund?");
    await composer.press("Enter");
    await expect(composer).toHaveValue("");
    await expect(
      page.getByRole("rowheader", {
        name: "Enthält der Vertrag eine Kündigung aus wichtigem Grund?",
      }),
    ).toBeVisible({ timeout: 15_000 });
    // Shift+Enter bleibt in derselben Frage.
    await composer.fill("Erste Zeile");
    await composer.press("Shift+Enter");
    await expect(composer).toHaveValue("Erste Zeile\n");
    await composer.fill("");

    await addColumn(page, {
      label: "Anwendbares Recht",
      type: "Auswahl",
      instructions: "Which law governs the document?",
      criteria: [
        ["Deutsches Recht", "German law governs."],
        ["Österreichisches Recht", "Austrian law governs."],
      ],
    });
    await expect(page.getByText("Noch nicht geprüft")).toHaveCount(2);

    // Ohne gespeicherten API-Key ist der Start gesperrt und nennt den Grund.
    await expect(page.getByRole("button", { name: "Analyse starten" })).toBeDisabled();
    await expect(page.getByTestId("review-start-reason")).toHaveText(
      "Es ist kein API-Key gespeichert.",
    );

    // Ein fertiger Lauf, direkt in der Testdatenbank — ohne Modellaufruf.
    const seeded = await seedFinishedReviewRun(reviewTableId);
    await page.reload();
    await expect(page.getByText(/^Abgeschlossen 100 %$/u)).toBeVisible();

    const cell = page.getByRole("button", {
      name: "Zelle öffnen: Beispiel-IKT-Sicherheitsrichtlinie.docx, Anwendbares Recht",
    });
    await expect(cell).toContainText("Deutsches Recht");
    // Die Konfidenz von Jev steht in der Zelle.
    await expect(cell).toContainText("83 %");
    await cell.click();

    const sheet = page.getByTestId("review-cell-sheet");
    await expect(sheet.getByRole("heading", { name: "Anwendbares Recht" })).toBeVisible();
    // Der erste Aufruf kompiliert die Detail-Route im Entwicklungsserver.
    await expect(sheet.getByText("Beleg [1].")).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByText("Belege 1")).toBeVisible();
    // Beleg [1] in der Liste und im Text sind dieselbe Stelle.
    await sheet.getByRole("button", { name: "Beleg im Dokument zeigen 1" }).click();
    await sheet.getByRole("tab", { name: "Text" }).click();
    const highlighted = sheet.locator("[data-active] mark");
    await expect(highlighted.first()).toBeVisible();
    await expect(highlighted.first()).toContainText(seeded.evidenceQuotes[0]!.slice(0, 20));
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);

    // Export lädt, sobald der Lauf beendet ist.
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Excel exportieren" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/u);
    expect(pageErrors).toEqual([]);
  });

  test("serves the English review workspace", async ({ page }) => {
    await page.goto("/en/reviews");
    await expect(page.getByRole("heading", { name: "Contract review" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contract review", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});
