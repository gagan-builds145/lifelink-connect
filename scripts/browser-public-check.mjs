import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.LIFELINK_BASE_URL ?? "http://127.0.0.1:5173";
const outDir = "browser-screenshots/phase5-final";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

async function inspect(name, viewport, path, checks) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const networkFailures = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.startsWith("ws:") && !url.startsWith("wss:")) {
      networkFailures.push(`${request.method()} ${url}: ${request.failure()?.errorText}`);
    }
  });

  const response = await page.goto(`${base}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(2_500);
  const title = await page.title();
  const heading = await page.locator("h1").first().textContent().catch(() => null);
  const bodyText = (await page.locator("body").innerText()).slice(0, 2_000);
  const result = {
    name,
    path,
    viewport: `${viewport.width}x${viewport.height}`,
    status: response?.status() ?? null,
    finalUrl: page.url(),
    title,
    heading: heading?.trim() ?? null,
    checks: {},
    consoleErrors,
    pageErrors,
    networkFailures,
    screenshot: `${outDir}/${name}.png`,
  };
  for (const [key, fn] of Object.entries(checks)) {
    try {
      result.checks[key] = await fn(page, bodyText);
    } catch (error) {
      result.checks[key] = `FAILED: ${error.message}`;
    }
  }
  await page.screenshot({ path: result.screenshot, fullPage: true });
  results.push(result);
  await context.close();
}

await inspect(
  "landing-desktop",
  { width: 1440, height: 900 },
  "/",
  {
    isLanding: (_page, text) => /LifeLink/i.test(text) && /Sign in/i.test(text),
    noHorizontalOverflow: (page) =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    hasMainLandmark: (page) => page.locator("main").count().then((n) => n > 0),
  },
);

await inspect(
  "landing-mobile",
  { width: 390, height: 844 },
  "/",
  {
    noHorizontalOverflow: (page) =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
    hasVisibleHeading: (page) =>
      page.locator("h1").first().isVisible().catch(() => false),
  },
);

await inspect(
  "protected-community-redirect",
  { width: 1440, height: 900 },
  "/community/dashboard",
  {
    redirectedToAuth: (page) => page.url().includes("/auth"),
    keepsReturnPath: (page) => page.url().includes("returnTo="),
    authFormVisible: (page) => page.locator("#otp-email").isVisible(),
  },
);

await inspect(
  "protected-ambulance-redirect-mobile",
  { width: 390, height: 844 },
  "/ambulance",
  {
    redirectedToAuth: (page) => page.url().includes("/auth"),
    keepsReturnPath: (page) => page.url().includes("returnTo="),
    noHorizontalOverflow: (page) =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  },
);

await inspect(
  "public-blood-search-mobile",
  { width: 390, height: 844 },
  "/blood-search",
  {
    pageRendered: (page) => page.locator("body").innerText().then((text) => text.length > 100),
    noHorizontalOverflow: (page) =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2),
  },
);

await browser.close();
console.log(JSON.stringify(results, null, 2));
