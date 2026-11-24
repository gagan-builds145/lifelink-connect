import fs from "node:fs";
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5173";
const OUT = "browser-screenshots/final-verification";
const PASSWORD = "LifeLinkTest2026!";

const mail = async (path, options = {}) => {
  const response = await fetch(`https://api.mail.tm${path}`, options);
  const text = await response.text();
  return { ok: response.ok, status: response.status, json: text ? JSON.parse(text) : {} };
};

async function login(page, email) {
  const token = await mail("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: PASSWORD }),
  });
  const jwt = token.json.token;
  const list = await mail("/messages", { headers: { Authorization: `Bearer ${jwt}` } });
  for (const message of list.json["hydra:member"] ?? []) {
    await mail(`/messages/${message.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${jwt}` },
    });
  }
  await page.goto(`${BASE}/auth`);
  await page.locator("#otp-email").fill(email);
  await page.getByRole("button", { name: /Send sign-in code/i }).click();
  await page.getByLabel("6-digit verification code").waitFor({ timeout: 25_000 });
  let code = null;
  for (let i = 0; i < 50 && !code; i += 1) {
    await page.waitForTimeout(2000);
    const messages = await mail("/messages", { headers: { Authorization: `Bearer ${jwt}` } });
    for (const message of messages.json["hydra:member"] ?? []) {
      const match = `${message.intro ?? ""} ${message.subject ?? ""}`.match(/\b\d{6}\b/);
      if (match) {
        code = match[0];
        break;
      }
    }
  }
  if (!code) throw new Error("No OTP");
  await page.getByLabel("6-digit verification code").fill(code);
  await page.waitForTimeout(9000);
}

const browser = await chromium.launch({ headless: true });
const report = {};
try {
  const guardianContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guardianPage = await guardianContext.newPage();
  await login(guardianPage, "lifelinkguardianb@euploading.com");
  report.guardianLoginUrl = guardianPage.url();
  await guardianPage.goto(`${BASE}/guardian/onboarding`);
  await guardianPage.waitForTimeout(2500);
  report.onboardingUrl = guardianPage.url();
  report.onboardingHeading = await guardianPage.locator("h1").first().textContent().catch(() => null);
  await guardianPage.screenshot({
    path: `${OUT}/guardian-onboarding.png`,
    fullPage: true,
  });

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
    "base64",
  );
  await guardianPage.locator('input[type="file"]').setInputFiles({
    name: "guardian-test.png",
    mimeType: "image/png",
    buffer: png,
  });
  await guardianPage.waitForTimeout(5000);
  report.uploadToast = await guardianPage
    .locator("[data-sonner-toast]")
    .innerText()
    .catch(() => "");
  report.uploadDocumentsText = (
    await guardianPage.getByRole("heading", { name: "6. Documents" }).locator("..").innerText().catch(() => "")
  ).slice(0, 800);
  await guardianPage.screenshot({
    path: `${OUT}/guardian-document-submission.png`,
    fullPage: true,
  });

  await guardianPage.goto(`${BASE}/ambulance`);
  await guardianPage.waitForTimeout(3500);
  report.ambulanceUrl = guardianPage.url();
  report.ambulanceText = (await guardianPage.locator("body").innerText()).slice(0, 900);
  await guardianPage.screenshot({
    path: `${OUT}/ambulance-discovery.png`,
    fullPage: true,
  });
  await guardianContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminPage = await adminContext.newPage();
  await login(adminPage, "lifelinkadminb@euploading.com");
  await adminPage.goto(`${BASE}/admin/dashboard`);
  await adminPage.waitForTimeout(2500);
  await adminPage.getByRole("button", { name: /Guardian applications/i }).click();
  await adminPage.waitForTimeout(1200);
  report.adminReviewText = (await adminPage.locator("body").innerText()).slice(0, 1400);
  await adminPage.screenshot({
    path: `${OUT}/admin-guardian-document-review.png`,
    fullPage: true,
  });
  await adminContext.close();
  fs.writeFileSync(`${OUT}/guardian-ui-report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
