import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.LIFELINK_BASE_URL ?? "http://127.0.0.1:5173";
const MAIL_PASSWORD = process.env.LIFELINK_TEST_MAIL_PASSWORD ?? "LifeLinkTest2026!";
const OUT = path.resolve(
  process.env.LIFELINK_SCREENSHOT_DIR ?? "browser-screenshots/final-verification",
);
fs.mkdirSync(OUT, { recursive: true });

const ROLES = [
  {
    key: "requestor",
    label: "Requestor",
    state: "/tmp/lifelink-requestor-state.json",
    expectedPath: "/community/dashboard",
    expectedHeading: "Requestor dashboard",
    email: "lifelinkrequestorb@euploading.com",
    mailbox: "lifelinkrequestorb@euploading.com",
    settingsProfile: "requestor",
    notification: "mark-all",
    location: "denied",
    createRequest: true,
  },
  {
    key: "donor",
    label: "Donor",
    state: "/tmp/donor-state.json",
    expectedPath: "/community/dashboard",
    expectedHeading: "Donor dashboard",
    email: "lifelink.donor.20261124a@euploading.com",
    mailbox: "lifelinkdonor20261124a@euploading.com",
    settingsProfile: "donor",
    notification: "individual",
    location: "enabled",
  },
  {
    key: "hospital",
    label: "Hospital",
    state: "/tmp/lifelink-hospital-state.json",
    expectedPath: "/hospital/dashboard",
    expectedHeading: "Hospital dashboard",
    email: "lifelinkhospitalb@euploading.com",
    mailbox: "lifelinkhospitalb@euploading.com",
    headerProfile: "Hospital profile",
    notification: "mark-all",
  },
  {
    key: "red_cross",
    label: "Red Cross / Blood Bank",
    state: "/tmp/lifelink-red_cross-state.json",
    expectedPath: "/red-cross/dashboard",
    expectedHeading: "Blood bank dashboard",
    email: "lifelinkred_crossb@euploading.com",
    mailbox: "lifelinkred_crossb@euploading.com",
    notification: "mark-all",
  },
  {
    key: "guardian",
    label: "Guardian",
    state: "/tmp/lifelink-guardian-state.json",
    expectedPath: "/guardian/dashboard",
    expectedHeading: "Guardian ambulance dashboard",
    email: "lifelinkguardianb@euploading.com",
    mailbox: "lifelinkguardianb@euploading.com",
    notification: "empty-or-read",
  },
  {
    key: "admin",
    label: "Admin",
    state: "/tmp/lifelink-admin-state.json",
    expectedPath: "/admin/dashboard",
    expectedHeading: "Network control room",
    email: "lifelinkadminb@euploading.com",
    mailbox: "lifelinkadminb@euploading.com",
    notification: "empty-or-read",
  },
];

async function mail(path, options = {}) {
  const response = await fetch(`https://api.mail.tm${path}`, options);
  const text = await response.text();
  return { ok: response.ok, status: response.status, json: text ? JSON.parse(text) : {} };
}

async function clearMailbox(role) {
  const token = await mail("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: role.mailbox, password: MAIL_PASSWORD }),
  });
  if (!token.ok) throw new Error(`${role.key}: mailbox login failed (${token.status})`);
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

async function newestOtp(token) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
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
  throw new Error("OTP email did not arrive");
}

async function performLogin(page, role) {
  const mailboxToken = await clearMailbox(role);
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.locator("#otp-email").fill(role.email);
  await page.getByRole("button", { name: /Send sign-in code/i }).click();
  await page.getByLabel("6-digit verification code").waitFor({ timeout: 25_000 });
  await page.waitForTimeout(1200);
  const code = await newestOtp(mailboxToken);
  await page.getByLabel("6-digit verification code").fill(code);
  await page
    .waitForURL(new RegExp(role.expectedPath.replace(/[/]/g, "\\/")), {
      timeout: 60_000,
      waitUntil: "commit",
    })
    .catch(async () => {
      await page.waitForTimeout(8000);
      if (!page.url().includes(role.expectedPath)) {
        throw new Error(
          `${role.key}: OTP login did not reach ${role.expectedPath}; at ${page.url()}`,
        );
      }
    });
  await page.waitForTimeout(2200);
}

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  public: {},
  roles: {},
  protectedRoutes: {},
  locationConsent: {},
  loadingScreen: {},
  gaps: [],
};

function missingState(role) {
  if (!fs.existsSync(role.state)) {
    report.gaps.push(`Missing saved authenticated state for ${role.label}: ${role.state}`);
    return true;
  }
  return false;
}

async function closeLocationPrompt(page) {
  const dialog = page.getByRole("dialog", { name: "Enable location services?" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Not Now" }).click().catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function pageMetrics(page, name) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const overflow = Math.max(doc.scrollWidth, body.scrollWidth) - window.innerWidth;
    const clippedText = Array.from(document.querySelectorAll("h1,h2,h3,p,button,a,span"))
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const text = (el.textContent ?? "").trim();
        if (!text || el.children.length > 2) return false;
        if (style.textOverflow === "ellipsis" || style.overflow === "hidden") return false;
        return el.scrollWidth > el.clientWidth + 2 && style.whiteSpace !== "normal";
      })
      .slice(0, 10)
      .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 60)}`);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      overflow,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      clippedText,
      bodyTextLength: body.innerText.length,
    };
  });
  report.roles[currentRole] ??= {};
  report.roles[currentRole].screenshots ??= [];
  report.roles[currentRole].screenshots.push(name);
  return metrics;
}

let currentRole = "public";

async function testNotification(page, role) {
  const trigger = page.locator('button[aria-label^="Notifications"]').first();
  if (!(await trigger.count())) return { available: false };
  const before = await trigger.getAttribute("aria-label");
  await trigger.click();
  await page.waitForTimeout(700);
  const panelText = await page
    .locator('[data-slot="popover-content"]')
    .innerText()
    .catch(() => "");
  const unreadMatch = before?.match(/(\d+) unread/);
  const beforeUnread = unreadMatch ? Number(unreadMatch[1]) : 0;
  const hasMarkAll = await page.getByRole("button", { name: "Mark all read" }).isVisible().catch(() => false);
  const notificationCount = await page
    .locator('[data-slot="popover-content"] button')
    .filter({ hasNotText: "Mark all read" })
    .count()
    .catch(() => 0);
  const shot = `${role.key}-notification-open.png`;
  await page.screenshot({ path: path.join(OUT, shot), fullPage: false });
  report.roles[role.key].screenshots.push(shot);

  const result = {
    available: true,
    beforeLabel: before,
    beforeUnread,
    hasMarkAll,
    notificationCount,
    panelText: panelText.slice(0, 300),
    emptyState: /No notifications yet/.test(panelText),
    actions: {},
  };

  if (role.notification === "individual" && notificationCount > 0) {
    const first = page
      .locator('[data-slot="popover-content"] button')
      .filter({ hasNotText: "Mark all read" })
      .first();
    await first.click();
    await page.waitForTimeout(1000);
    const after = await trigger.getAttribute("aria-label");
    result.actions.individual = { afterLabel: after, url: page.url() };
    await trigger.click();
    await page.waitForTimeout(400);
    result.actions.individual.panelAfter = (
      await page.locator('[data-slot="popover-content"]').innerText().catch(() => "")
    ).slice(0, 160);
  }

  if (role.notification === "mark-all" && hasMarkAll) {
    await page.getByRole("button", { name: "Mark all read" }).click();
    await page.waitForTimeout(900);
    const after = await trigger.getAttribute("aria-label");
    const text = await page.locator('[data-slot="popover-content"]').innerText().catch(() => "");
    result.actions.markAll = { afterLabel: after, upToDate: /You are up to date/.test(text) };
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    result.actions.markAll.afterReload = await page
      .locator('button[aria-label^="Notifications"]')
      .first()
      .getAttribute("aria-label");
  } else if (!hasMarkAll) {
    await page.keyboard.press("Escape");
  }
  return result;
}

async function testCommunityProfile(page, role) {
  if (!role.settingsProfile) return { available: false };
  const settings = page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true });
  if (!(await settings.count())) return { available: false, reason: "No Settings navigation item" };
  await settings.click();
  await page.waitForTimeout(800);
  const shot = `${role.key}-settings-profile.png`;
  await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
  report.roles[role.key].screenshots.push(shot);

  const kind = role.settingsProfile;
  const id = kind === "donor" ? "#profile-donor-phone" : "#profile-requestor-phone";
  const field = page.locator(id);
  if (!(await field.count())) return { available: true, editable: false, reason: `${id} not found` };
  const value = `+91 90000 ${kind === "donor" ? "10010" : "20006"}`;
  await field.fill(value);
  const saveName = kind === "donor" ? "Save donor details" : "Save requestor details";
  await page.getByRole("button", { name: saveName }).click();
  await page.waitForTimeout(1400);
  const toast = await page.locator("[data-sonner-toast]").innerText().catch(() => "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2300);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.waitForTimeout(700);
  const persisted = await page.locator(id).inputValue().catch(() => null);
  return {
    available: true,
    editable: true,
    value,
    persisted: persisted?.replace(/\s/g, "") === value.replace(/\s/g, ""),
    persistedValue: persisted,
    toast: toast.slice(0, 160),
  };
}

async function testHospitalProfile(page, role) {
  if (!role.headerProfile) return { available: false };
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.waitForTimeout(300);
  const item = page.getByRole("button", { name: role.headerProfile });
  if (!(await item.count())) return { available: false, reason: "Profile item not in account menu" };
  await item.click();
  await page.waitForTimeout(900);
  const shot = `${role.key}-settings-profile.png`;
  await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
  report.roles[role.key].screenshots.push(shot);

  const field = page.locator("#hosp-phone");
  if (!(await field.count())) return { available: true, editable: false };
  const value = "+91 90000 30013";
  await field.fill(value);
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.waitForTimeout(1400);
  const toast = await page.locator("[data-sonner-toast]").innerText().catch(() => "");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2300);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: role.headerProfile }).click();
  await page.waitForTimeout(700);
  const persisted = await page.locator("#hosp-phone").inputValue().catch(() => null);
  return {
    available: true,
    editable: true,
    location: "header account menu (not a Settings page)",
    value,
    persisted: persisted?.replace(/\s/g, "") === value.replace(/\s/g, ""),
    persistedValue: persisted,
    toast: toast.slice(0, 160),
  };
}

async function testCreateRequest(page, role) {
  if (!role.createRequest) return { available: false };
  await page.goto(`${BASE}/community/dashboard?section=request`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "New request" }).click();
  await page.waitForTimeout(600);
  const unique = Date.now().toString().slice(-6);
  await page.locator("#patient-name").fill("LifeLink Browser Test Patient");
  await page.locator("#patient-ref").fill(`BROWSER-${unique}`);
  await page.locator("#hospital-name").fill("LifeLink Test Hospital b");
  await page.locator("#reason").fill(
    "Authenticated browser verification of blood request creation and network notifications.",
  );
  await page.screenshot({
    path: path.join(OUT, "requestor-create-request-form.png"),
    fullPage: true,
  });
  await page.getByRole("checkbox").last().check();
  await page.getByRole("button", { name: "Submit request for verification" }).click();
  await page.waitForTimeout(4000);
  const toast = await page.locator("[data-sonner-toast]").innerText().catch(() => "");
  const body = await page.locator("body").innerText();
  const requestId = body.match(/LL-R-\d+/)?.[0] ?? toast.match(/LL-R-\d+/)?.[0] ?? null;
  await page.screenshot({
    path: path.join(OUT, "requestor-request-created.png"),
    fullPage: true,
  });
  return {
    available: true,
    submitted: Boolean(requestId) || /submitted/i.test(toast),
    requestId,
    toast: toast.slice(0, 200),
  };
}

async function desktopRole(browser, role) {
  currentRole = role.key;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    permissions: role.location === "enabled" ? ["geolocation"] : [],
    geolocation:
      role.location === "enabled"
        ? { latitude: 18.5204, longitude: 73.8567, accuracy: 12 }
        : undefined,
  });
  const page = await context.newPage();
  await performLogin(page, role);
  await context.storageState({ path: role.state });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));
  page.on("requestfailed", (req) => {
    const failure = req.failure()?.errorText ?? "failed";
    if (!/net::ERR_ABORTED|net::ERR_NAME_NOT_RESOLVED/.test(failure)) {
      failedRequests.push(`${req.method()} ${req.url().slice(0, 180)} ${failure}`);
    }
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  const result = (report.roles[role.key] = {
    label: role.label,
    state: role.state,
    rootRedirectUrl: page.url(),
    rootRedirectCorrect: page.url().endsWith(role.expectedPath),
    heading: await page.locator("h1").first().textContent().catch(() => null),
    consoleErrors,
    pageErrors,
    failedRequests,
  });

  if (role.location) {
    const dialog = page.getByRole("dialog", { name: "Enable location services?" });
    const visible = await dialog.isVisible().catch(() => false);
    if (visible) {
      await page.screenshot({
        path: path.join(OUT, `${role.key}-location-consent-prompt.png`),
        fullPage: false,
      });
      await dialog.getByRole("button", { name: "Enable Location" }).click();
      await page.waitForTimeout(1800);
      const error = await dialog.locator('[role="alert"]').innerText().catch(() => null);
      const storage = await page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith("lifelink:location-choice:"))
          .map((key) => [key, localStorage.getItem(key)]),
      );
      report.locationConsent[role.location] = { promptVisible: visible, error, storage };
      await page.screenshot({
        path: path.join(OUT, `${role.key}-location-consent-result.png`),
        fullPage: false,
      });
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole("button", { name: "Not Now" }).click().catch(() => {});
      }
    } else {
      report.locationConsent[role.location] = { promptVisible: false };
    }
  } else {
    await closeLocationPrompt(page);
  }
  await page.waitForTimeout(400);
  const dashboardShot = `${role.key}-dashboard-desktop.png`;
  await page.screenshot({ path: path.join(OUT, dashboardShot), fullPage: true });
  result.desktop = await pageMetrics(page, dashboardShot);

  const aside = page.locator("aside").first();
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(OUT, `${role.key}-sidebar-independent-scroll.png`),
    fullPage: false,
  });
  result.sidebar = {
    visible: await aside.isVisible().catch(() => false),
    navButtons: await aside.locator("nav button").count().catch(() => 0),
    scroll: await page.evaluate(() => {
      const side = document.querySelector("aside");
      const viewport = side?.querySelector('[data-slot="scroll-area-viewport"]');
      if (!viewport) return { found: false };
      const before = { top: viewport.scrollTop, scrollY: window.scrollY };
      viewport.scrollTop = 160;
      const after = {
        top: viewport.scrollTop,
        scrollY: window.scrollY,
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
      };
      viewport.scrollTop = before.top;
      return { found: true, before, after };
    }),
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const nav = aside.locator("nav button");
  if ((await nav.count()) > 1) {
    const firstLabel = await nav.nth(0).innerText();
    await nav.nth(1).click();
    await page.waitForTimeout(800);
    result.sidebar.secondItem = {
      label: (await nav.nth(1).innerText()).trim(),
      current: await nav.nth(1).getAttribute("aria-current"),
    };
    await page.screenshot({
      path: path.join(OUT, `${role.key}-sidebar-navigation.png`),
      fullPage: false,
    });
    report.roles[role.key].screenshots.push(`${role.key}-sidebar-navigation.png`);
    await nav.nth(0).click();
    await page.waitForTimeout(500);
    result.sidebar.restoredFirst = (await nav.nth(0).innerText()).trim() === firstLabel.trim();
  }

  result.notifications = await testNotification(page, role).catch((err) => ({ error: String(err) }));

  if (role.settingsProfile) {
    result.profile = await testCommunityProfile(page, role).catch((err) => ({ error: String(err) }));
  } else if (role.headerProfile) {
    result.profile = await testHospitalProfile(page, role).catch((err) => ({ error: String(err) }));
  } else {
    result.profile = {
      available: false,
      reason:
        "This dashboard has no Settings/profile page. Guardian uses onboarding; Red Cross and Admin expose no account profile editor.",
    };
    report.gaps.push(`${role.label}: no Settings profile editing surface found.`);
  }

  if (role.createRequest) {
    result.requestCreation = await testCreateRequest(page, role).catch((err) => ({ error: String(err) }));
  }

  await page.goto(`${BASE}${role.expectedPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const logoLink = page.locator('aside a[aria-label="LifeLink dashboard"]').first();
  result.logo = { found: await logoLink.count() > 0 };
  if (result.logo.found) {
    await logoLink.click();
    await page.waitForTimeout(1000);
    result.logo.afterUrl = page.url();
    result.logo.correct = page.url().endsWith(role.expectedPath);
  }

  await mobileRole(page, role);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  if (role.key === "donor") {
    result.protectedRoutes = {};
    for (const target of [
      "/admin/dashboard",
      "/hospital/dashboard",
      "/red-cross/dashboard",
      "/guardian/dashboard",
    ]) {
      await page.goto(`${BASE}${target}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      result.protectedRoutes[target] = {
        url: page.url(),
        heading: await page.locator("h1").first().textContent().catch(() => null),
        body: (await page.locator("body").innerText()).slice(0, 280),
      };
      if (target === "/admin/dashboard") {
        await page.screenshot({
          path: path.join(OUT, "donor-blocked-from-admin.png"),
          fullPage: true,
        });
      }
    }
    await page.goto(`${BASE}${role.expectedPath}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    await context.storageState({ path: "/tmp/lifelink-final-session-state.json" });
  }

  result.finalDesktopUrl = page.url();
  await context.close();
  if (role.key === "donor") {
    await testFinalSessionLifecycle(browser).catch((error) => {
      report.gaps.push(`Final session lifecycle check failed: ${String(error).slice(0, 300)}`);
    });
  }
}

async function mobileRole(page, role) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}${role.expectedPath}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await closeLocationPrompt(page);
  await page.waitForTimeout(300);
  const collapsed = `${role.key}-dashboard-mobile-collapsed.png`;
  await page.screenshot({ path: path.join(OUT, collapsed), fullPage: true });
  const result = (report.roles[role.key].mobile = {
    viewport: { width: 390, height: 844 },
    collapsed: await pageMetrics(page, collapsed),
    menuButtonVisible: await page.getByRole("button", { name: "Open dashboard menu" }).isVisible().catch(() => false),
  });

  if (result.menuButtonVisible) {
    await page.getByRole("button", { name: "Open dashboard menu" }).click();
    await page.waitForTimeout(800);
    const expanded = `${role.key}-dashboard-mobile-expanded.png`;
    await page.screenshot({ path: path.join(OUT, expanded), fullPage: false });
    result.expanded = await pageMetrics(page, expanded);
    result.expanded.navButtons = await page.locator("aside nav button").count().catch(() => 0);
    result.expandedScroll = await page.evaluate(() => {
      const viewport = document.querySelector('aside [data-slot="scroll-area-viewport"]');
      if (!viewport) return { found: false };
      const before = { top: viewport.scrollTop, scrollY: window.scrollY };
      viewport.scrollTop = 160;
      const after = { top: viewport.scrollTop, scrollY: window.scrollY };
      viewport.scrollTop = before.top;
      return { found: true, before, after };
    });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function testSignedOut(browser) {
  currentRole = "public";
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  report.public.landing = {
    url: page.url(),
    heading: await page.locator("h1").first().textContent().catch(() => null),
    hasLogin: await page.getByRole("link", { name: "Log in" }).first().isVisible().catch(() => false),
    hasCreateAccount: await page
      .getByRole("link", { name: "Create account" })
      .first()
      .isVisible()
      .catch(() => false),
  };
  await page.screenshot({ path: path.join(OUT, "signed-out-landing.png"), fullPage: true });
  await page.goto(`${BASE}/admin/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  report.public.protectedAdmin = {
    url: page.url(),
    body: (await page.locator("body").innerText()).slice(0, 500),
    signInVisible: await page.getByRole("button", { name: "Sign in" }).isVisible().catch(() => false),
  };
  await page.screenshot({ path: path.join(OUT, "signed-out-protected-route.png"), fullPage: true });
  await context.close();
}

async function testFinalSessionLifecycle(browser) {
  const state = "/tmp/lifelink-final-session-state.json";
  if (!fs.existsSync(state)) {
    report.gaps.push("Missing dedicated final-session state for loading/logout verification.");
    return;
  }
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await context.route("**/*", async (route) => {
    const type = route.request().resourceType();
    if (type === "xhr" || type === "fetch") {
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    await route.continue();
  });
  await page.goto(`${BASE}/community/dashboard`, { waitUntil: "commit" });
  const loadingVisible = await page
    .getByText("Loading LifeLink")
    .waitFor({ timeout: 6_000 })
    .then(() => true)
    .catch(() => false);
  const immediate = (await page.locator("body").innerText()).slice(0, 220);
  await page.screenshot({ path: path.join(OUT, "auth-restoration-loading.png"), fullPage: false });
  report.loadingScreen = {
    textObserved: immediate,
    showsLoadingScreen: loadingVisible,
  };
  await page.getByRole("button", { name: "Account menu" }).waitFor({ timeout: 25_000 });
  await page.waitForTimeout(600);
  await closeLocationPrompt(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
  await page.waitForTimeout(400);
  const dialogSeen = await page.getByText("Log out of LifeLink?").isVisible().catch(() => false);
  await page.screenshot({ path: path.join(OUT, "logout-confirmation.png"), fullPage: false });
  await page.getByRole("button", { name: "Yes, Log Out" }).click({ timeout: 15_000 });
  await page.waitForTimeout(3500);
  report.logout = { dialogSeen, url: page.url(), success: page.url().endsWith("/login") };
  await page.screenshot({ path: path.join(OUT, "logout-success-login.png"), fullPage: true });
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await testSignedOut(browser);
  for (const role of ROLES) {
    await desktopRole(browser, role);
    fs.writeFileSync(
      path.join(OUT, "authenticated-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(`checked ${role.key}`);
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "authenticated-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error?.stack ?? error);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "authenticated-report.json"), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
