/**
 * Creates genuine disposable-inbox LifeLink accounts through the real email OTP
 * signup UI. No session is fabricated and no authorization is bypassed.
 *
 * Usage: node scripts/browser-create-accounts.mjs [roles...]
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const BASE = process.env.LIFELINK_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.LIFELINK_TEST_MAIL_PASSWORD ?? "LifeLinkTest2026!";
const STAMP = process.env.LIFELINK_TEST_STAMP ?? String(Date.now()).slice(-8);

const ROLES = {
  donor: {
    route: "/signup/donor",
    formSelector: "#donor-name",
    button: /Create donor profile/i,
    done: /community\/dashboard/,
    fill: async (page) => {
      await page.locator("#donor-name").fill("LifeLink Test Donor");
      await page.locator("#donor-dob").fill("1990-01-01");
      await page.locator("#donor-phone").fill("9000000201");
      await page.locator("#donor-address").fill("12 Test Road, Pune");
      await page.locator("#donor-area").fill("Kothrud");
    },
    consent: true,
  },
  requestor: {
    route: "/signup/requestor",
    formSelector: "#requestor-name",
    button: /Add requestor access/i,
    done: /community\/dashboard/,
    fill: async (page) => {
      await page.locator("#requestor-name").fill("LifeLink Test Requestor");
      await page.locator("#requestor-phone").fill("9000000202");
    },
    consent: true,
  },
  hospital: {
    route: "/signup/hospital",
    formSelector: "#org-name",
    button: /Register hospital/i,
    done: /hospital\/dashboard/,
    fill: async (page, email) => {
      await page.locator("#org-name").fill(`LifeLink Test Hospital ${STAMP}`);
      await page.locator("#org-contact").fill("LifeLink Test Hospital Admin");
      await page.locator("#org-phone").fill("9000000203");
      await page.locator("#org-email").fill(email);
      await page.locator("#org-address").fill("44 Test Hospital Road, Pune");
      await page.locator("#org-area").fill("Shivajinagar");
    },
    consent: true,
  },
  red_cross: {
    route: "/signup/red-cross",
    formSelector: "#org-name",
    button: /Register branch/i,
    done: /red-cross\/dashboard/,
    fill: async (page, email) => {
      await page.locator("#org-name").fill(`LifeLink Test Blood Bank ${STAMP}`);
      await page.locator("#org-contact").fill("LifeLink Test Blood Bank Admin");
      await page.locator("#org-phone").fill("9000000204");
      await page.locator("#org-email").fill(email);
      await page.locator("#org-address").fill("18 Test Blood Bank Road, Pune");
      await page.locator("#org-area").fill("Camp");
    },
    consent: true,
  },
  guardian: {
    route: "/signup/guardian",
    formSelector: "#guardian-company",
    button: /Create Guardian account/i,
    done: /guardian\/dashboard/,
    fill: async (page) => {
      await page.locator("#guardian-company").fill(`LifeLink Test Ambulance ${STAMP}`);
      await page.locator("#guardian-contact").fill("LifeLink Test Guardian");
      await page.locator("#guardian-phone").fill("9000000205");
      await page.locator("#guardian-city").fill("Pune");
      await page.locator("#guardian-address").fill("7 Test Ambulance Depot, Pune");
    },
    consent: false,
  },
};

async function mail(path, options = {}) {
  const response = await fetch(`https://api.mail.tm${path}`, options);
  const text = await response.text();
  return { ok: response.ok, status: response.status, json: text ? JSON.parse(text) : {} };
}

async function createInbox(role) {
  const address = `lifelink${role}${STAMP}@euploading.com`;
  let account;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    account = await mail("/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, password: PASSWORD }),
    });
    if (account.ok || account.status === 422) break;
    if (account.status !== 429) {
      throw new Error(`Mailbox creation failed: ${account.status} ${JSON.stringify(account.json)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 65_000));
  }
  if (!account || (!account.ok && account.status !== 422)) {
    throw new Error(`Mailbox creation failed after retries: ${account?.status}`);
  }
  const token = await mail("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, password: PASSWORD }),
  });
  if (!token.ok) throw new Error(`Mailbox login failed: ${token.status}`);
  return { address, token: token.json.token };
}

async function clearMessages(box) {
  const list = await mail("/messages", { headers: { Authorization: `Bearer ${box.token}` } });
  if (!list.ok) return;
  for (const message of list.json["hydra:member"] ?? []) {
    await mail(`/messages/${message.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${box.token}` },
    });
  }
}

async function newestCode(box) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const list = await mail("/messages", { headers: { Authorization: `Bearer ${box.token}` } });
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

async function createRole(browser, role) {
  const config = ROLES[role];
  if (!config) throw new Error(`Unknown role ${role}`);
  const box = await createInbox(role);
  await clearMessages(box);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("html2canvas-pro")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${BASE}${config.route}`, { waitUntil: "domcontentloaded" });
  await page.locator("#otp-email").fill(box.address);
  await page.getByRole("button", { name: /Send sign-in code/i }).click();
  await page.getByLabel("6-digit verification code").waitFor({ timeout: 20_000 });
  const code = await newestCode(box);
  await page.getByLabel("6-digit verification code").fill(code);
  await page.locator(config.formSelector).waitFor({ timeout: 25_000 });
  await config.fill(page, box.address);
  if (config.consent) await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: config.button }).click();
  await page.waitForURL(config.done, { timeout: 30_000 });
  await page.waitForTimeout(2500);
  const statePath = `/tmp/lifelink-${role}-state.json`;
  await context.storageState({ path: statePath });
  const result = {
    role,
    email: box.address,
    finalUrl: page.url(),
    title: (await page.locator("h1").first().textContent().catch(() => null))?.trim() ?? null,
    consoleErrors,
    pageErrors,
    statePath,
  };
  await context.close();
  return result;
}

const requested = process.argv.slice(2);
const roles = requested.length ? requested : Object.keys(ROLES);
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const role of roles) {
    const result = await createRole(browser, role);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await writeFile("/tmp/lifelink-created-accounts.json", JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
