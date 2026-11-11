import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
await mkdir("docs/screenshots", { recursive: true });

const browser = await chromium.launch({ channel: "chromium", headless: true });
const results = [];

async function audit(name, path, state, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, storageState: state ? `.auth/${state}.json` : undefined });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failed.push(`${request.url()} :: ${request.failure()?.errorText}`));
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const visibleText = [...document.querySelectorAll("h1,h2,h3,p,button,a,label,th,td")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .filter((element) => element.textContent?.trim());
    return {
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
      text: visibleText.map((element) => element.textContent?.trim()).join("\n").slice(0, 6000),
    };
  });
  await page.screenshot({ path: `docs/screenshots/${name}.jpg`, type: "jpeg", quality: 65, fullPage: false });
  const result = { name, path, url: page.url(), ...metrics, errors, failed: failed.slice(0, 10) };
  results.push(result);
  console.log(JSON.stringify({ name, h1: result.h1, horizontalOverflow: result.horizontalOverflow, scrollWidth: result.scrollWidth, errors: errors.length, failed: failed.length }));
  await context.close();
}

try {
  await audit("landing-desktop", "/", null);
  await audit("role-selection-desktop", "/signup", null);
  await audit("login-desktop", "/login", null);
  await audit("blood-search-desktop", "/blood-search", null);
  await audit("donor-dashboard-desktop", "/donor/dashboard", "donor");
  await audit("requestor-dashboard-desktop", "/requestor/dashboard", "requestor");
  await audit("redcross-dashboard-desktop", "/red-cross/dashboard", "red_cross");
  await audit("hospital-dashboard-desktop", "/hospital/dashboard", "hospital");
  await audit("supply-desktop", "/supply", "red_cross");
  await audit("drones-desktop", "/drones", "red_cross");
  await writeFile("docs/browser-audit.json", JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
