/**
 * Refreshes genuine authenticated Playwright storage states through the real
 * LifeLink email-OTP login UI. It does not create or fabricate a session.
 */
import { chromium } from "playwright";

const BASE = process.env.LIFELINK_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.LIFELINK_TEST_MAIL_PASSWORD ?? "LifeLinkTest2026!";

const ACCOUNTS = [
  {
    key: "donor",
    email: "lifelink.donor.20261124a@euploading.com",
    mailbox: "lifelinkdonor20261124a@euploading.com",
    state: "/tmp/donor-state.json",
    expected: /community\/dashboard/,
  },
  {
    key: "requestor",
    email: "lifelinkrequestorb@euploading.com",
    mailbox: "lifelinkrequestorb@euploading.com",
    state: "/tmp/lifelink-requestor-state.json",
    expected: /community\/dashboard/,
  },
  {
    key: "hospital",
    email: "lifelinkhospitalb@euploading.com",
    mailbox: "lifelinkhospitalb@euploading.com",
    state: "/tmp/lifelink-hospital-state.json",
    expected: /hospital\/dashboard/,
  },
  {
    key: "red_cross",
    email: "lifelinkred_crossb@euploading.com",
    mailbox: "lifelinkred_crossb@euploading.com",
    state: "/tmp/lifelink-red_cross-state.json",
    expected: /red-cross\/dashboard/,
  },
  {
    key: "guardian",
    email: "lifelinkguardianb@euploading.com",
    mailbox: "lifelinkguardianb@euploading.com",
    state: "/tmp/lifelink-guardian-state.json",
    expected: /guardian\/dashboard/,
  },
  {
    key: "admin",
    email: "lifelinkadminb@euploading.com",
    mailbox: "lifelinkadminb@euploading.com",
    state: "/tmp/lifelink-admin-state.json",
    expected: /admin\/dashboard/,
  },
];

async function mail(path, options = {}) {
  const response = await fetch(`https://api.mail.tm${path}`, options);
  const text = await response.text();
  return { ok: response.ok, status: response.status, json: text ? JSON.parse(text) : {} };
}

async function boxFor(account) {
  const token = await mail("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.mailbox, password: PASSWORD }),
  });
  if (!token.ok) throw new Error(`${account.key}: mailbox login failed ${token.status}`);
  const tokenValue = token.json.token;
  const list = await mail("/messages", { headers: { Authorization: `Bearer ${tokenValue}` } });
  for (const message of list.json["hydra:member"] ?? []) {
    await mail(`/messages/${message.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenValue}` },
    });
  }
  return tokenValue;
}

async function newestCode(token) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const list = await mail("/messages", { headers: { Authorization: `Bearer ${token}` } });
    if (list.ok) {
      for (const message of list.json["hydra:member"] ?? []) {
        const body = `${message.intro ?? ""} ${message.subject ?? ""}`;
        const code = body.match(/\b\d{6}\b/);
        if (code) return code[0];
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("No OTP email arrived");
}

const browser = await chromium.launch({ headless: true });
try {
  for (const account of ACCOUNTS) {
    const token = await boxFor(account);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
    await page.locator("#otp-email").fill(account.email);
    await page.getByRole("button", { name: /Send sign-in code/i }).click();
    await page.getByLabel("6-digit verification code").waitFor({ timeout: 20_000 });
    const code = await newestCode(token);
    await page.getByLabel("6-digit verification code").fill(code);
    await page
      .waitForURL(account.expected, { timeout: 45_000, waitUntil: "commit" })
      .catch(async () => {
        await page.waitForTimeout(8000);
        if (!account.expected.test(page.url())) {
          throw new Error(
            `${account.key}: login did not reach ${account.expected}; at ${page.url()}; body=${(await page.locator("body").innerText()).slice(0, 220)}`,
          );
        }
      });
    await page.waitForTimeout(2200);
    await context.storageState({ path: account.state });
    console.log(
      JSON.stringify({
        key: account.key,
        email: account.email,
        url: page.url(),
        heading: await page.locator("h1").first().textContent().catch(() => null),
        state: account.state,
      }),
    );
    await page.screenshot({
      path: `/tmp/relogin-${account.key}.png`,
      fullPage: false,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
