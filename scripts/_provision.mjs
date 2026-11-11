import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const stamp = Date.now().toString().slice(-7);
await mkdir(".auth", { recursive: true });

const browser = await chromium.launch({ channel: "chromium", headless: true });

async function guest(page) {
  await page.waitForLoadState("networkidle");
  const button = page.getByRole("button", { name: "Continue as demo guest" });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
  }
}

async function save(context, name, page, path) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await context.storageState({ path: `.auth/${name}.json` });
  console.log(JSON.stringify({ role: name, url: page.url(), title: await page.title(), path }));
}

async function donor() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signup/donor`, { waitUntil: "networkidle" });
  await guest(page);
  await page.getByLabel("Full name").fill(`E2E Donor ${stamp}`);
  await page.getByLabel("Date of birth").fill("1992-04-12");
  await page.getByLabel("Phone", { exact: true }).fill("9000000101");
  await page.getByLabel("Address / locality").fill("Synthetic E2E Lane 12");
  await page
    .locator("label")
    .filter({ hasText: "I confirm the details are accurate" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Create donor account" }).click();
  await page.waitForURL("**/donor/dashboard", { timeout: 20_000 });
  await save(context, "donor", page, "donor");
  await context.close();
}

async function requestor() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signup/requestor`, { waitUntil: "networkidle" });
  await guest(page);
  await page.getByLabel("Full name").fill(`E2E Requestor ${stamp}`);
  await page.getByLabel("Phone", { exact: true }).fill("9000000102");
  await page
    .locator("label")
    .filter({ hasText: "I confirm I am submitting on behalf" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Create requestor account" }).click();
  await page.waitForURL("**/requestor/dashboard", { timeout: 20_000 });
  await save(context, "requestor", page, "requestor");
  await context.close();
}

async function organization(role, label, emailLocal, phone) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/signup/${role === "red_cross" ? "red-cross" : "hospital"}`, { waitUntil: "networkidle" });
  await guest(page);
  await page.getByLabel(role === "red_cross" ? "Branch name" : "Hospital name").fill(label);
  await page.getByLabel("Contact person").fill(`E2E Staff ${stamp}`);
  await page.getByLabel("Official phone").fill(phone);
  await page.getByLabel("Official email").fill(`${emailLocal}.${stamp}@example.invalid`);
  await page.getByLabel("Address").fill("Synthetic E2E Health Campus 5");
  await page
    .locator("label")
    .filter({ hasText: "I confirm I am authorized to register" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: `Register ${role === "red_cross" ? "branch" : "hospital"}` }).click();
  await page.waitForURL(`**/${role === "red_cross" ? "red-cross" : "hospital"}/dashboard`, {
    timeout: 20_000,
  });
  await save(context, role, page, role);
  await context.close();
}

async function adminGuest() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await guest(page);
  await page.waitForURL("**/signup", { timeout: 20_000 });
  await save(context, "admin", page, "signup");
  await context.close();
}

try {
  await donor();
  await requestor();
  await organization("red_cross", `E2E Red Cross ${stamp}`, "e2e.redcross", "9000000103");
  await organization("hospital", `E2E Hospital ${stamp}`, "e2e.hospital", "9000000104");
  await adminGuest();
  console.log("PROVISIONED", stamp);
} finally {
  await browser.close();
}
