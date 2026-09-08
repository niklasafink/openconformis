import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.OPENROUTER_KEY;
if (!apiKey) throw new Error("OPENROUTER_KEY not set");

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

console.log("1) framework -> dora");
await page.goto(`${base}/de/analyses/new/framework?framework=dora`);
await page.getByRole("button", { name: "Weiter" }).click();
await page.waitForURL(/\/de\/analyses\/new\/policy\?/);

console.log("2) policy -> sample");
await page.getByRole("button", { name: "Auswählen", exact: true }).click();
await page.waitForURL(/\/de\/analyses\/new\/scope\?/);

console.log("3) scope -> keep only Art. 5 Abs. 2 DORA");
const checkboxes = page.locator('input[type="checkbox"][aria-label^="einschlägig:"]');
const count = await checkboxes.count();
for (let i = 0; i < count; i += 1) {
  const box = checkboxes.nth(i);
  const label = await box.getAttribute("aria-label");
  const shouldBeChecked = label?.includes("Art. 5 Abs. 2 DORA");
  const isChecked = await box.isChecked();
  if (shouldBeChecked !== isChecked) await box.click();
}
console.log("scope count text:", await page.locator(".scope-count").innerText());

const unevaluatedWarning = page.locator(".scope-model-warning input");
if (await unevaluatedWarning.count()) {
  await unevaluatedWarning.check();
  console.log("checked unevaluated-model warning");
}
const selectedModelLabel = await page
  .locator("#analysis-model option:checked")
  .innerText()
  .catch(() => "unknown");
console.log("selected model:", selectedModelLabel);

console.log("4) start analysis");
await page.getByRole("button", { name: "Analyse starten" }).click();
await page.waitForURL(/\/de\/analyses\/new\/results\?/, { timeout: 15000 });

console.log("5) waiting for BYOK dialog");
await page.locator("#preview-api-key").waitFor({ state: "visible", timeout: 15000 });
await page.locator("#preview-api-key").fill(apiKey);

console.log("6) connect credential and start real analysis");
await Promise.all([
  page.waitForURL(/\/de\/analyses\/[0-9a-f-]{36}$/, { timeout: 30000 }),
  page.getByRole("button", { name: "Verbinden und starten" }).click(),
]);
const analysisUrl = page.url();
console.log("analysis URL:", analysisUrl);

console.log("7) polling for completion");
let lastStatus = "";
for (let i = 0; i < 60; i += 1) {
  const statusEl = page.locator(".analysis-run-status");
  if (await statusEl.count()) {
    lastStatus = (await statusEl.getAttribute("data-status")) ?? "";
    console.log(`  [${i}] status=${lastStatus}`);
    if (lastStatus === "completed" || lastStatus === "failed" || lastStatus === "cancelled") break;
  }
  await page.waitForTimeout(3000);
  await page.reload();
}

if (lastStatus === "completed") {
  console.log("8) opening result");
  await page
    .waitForSelector(".result-list-row, [class*='result']", { timeout: 15000 })
    .catch(() => {});
  const bodyText = await page
    .locator("main")
    .first()
    .innerText()
    .catch(() => "(could not read main)");
  console.log("=== RESULT PAGE TEXT (truncated) ===");
  console.log(bodyText.slice(0, 4000));
} else {
  console.log("Analysis did not complete, last status:", lastStatus);
  const bodyText = await page
    .locator("main")
    .first()
    .innerText()
    .catch(() => "(could not read main)");
  console.log(bodyText.slice(0, 2000));
}

console.log("ANALYSIS_ID_MARKER:" + analysisUrl.split("/").pop());
await browser.close();
