const pw = require('/home/daytona/codebase/node_modules/playwright/index.js');

const OUT = '/home/daytona/codebase/browser-screenshots/lifelink-transfer';

async function go() {
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
  });

  const page = await ctx.newPage();

  const consoleMsgs = [];
  const consoleErrors = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    const t = msg.type();
    const txt = msg.text();
    consoleMsgs.push({ type: t, text: txt });
    if (t === 'error') consoleErrors.push(txt);
  });

  page.on('pageerror', (err) => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({ url: req.url(), failure: req.failure().reason });
  });

  // Snapshot helper
  let n = 0;
  const snap = async (name, extra = {}) => {
    n++;
    const slug = String(n).padStart(2, '0') + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
    const file = `${OUT}/${slug}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log('SCREENSHOT', file);
    return { file, name, ...extra };
  };

  try {
    // 1) Open app
    await page.goto('http://127.0.0.1:5173/auth?returnTo=/supply', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await snap('auth-open', { url: page.url() });

    // Capture the page doc text briefly
    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log('BODY TEXT (auth page):', bodyText.slice(0, 2000));

    // Keep browser open for manual sign-in
    await page.waitForFunction(
      () => {
        // simple heuristic: if we see dashboard-ish content, consider logged in
        const t = document.body ? document.body.innerText.toLowerCase() : '';
        return t.includes('supply') || t.includes('dashboard') || t.includes('blood') || t.includes('requests');
      },
      { timeout: 120000 }
    ).catch(() => {
      // Timeout is expected — user will sign in manually.
      console.log('Awaiting manual sign-in in browser (timeout expected).');
    });

    // Once signed in, capture the authenticated supply page
    await page.waitForTimeout(1500);
    await snap('after-signin', { url: page.url() });
    const afterText = await page.locator('body').innerText().catch(() => '');
    console.log('BODY TEXT (after sign-in):', afterText.slice(0, 2000));

    // Keep the browser alive so user can switch accounts manually.
    console.log('BROWSER_OPEN — please switch accounts manually (Hospital / Red Cross / Admin) and walk through the transfer lifecycle.');
    console.log('Call window.buffyContinue()" when ready to proceed to the next screen; otherwise screenshots below are the final ones this run captures.');
    await page.evaluate(() => {
      window.buffyContinue = async () => {
        // placeholder — inspector will drive next steps externally
        return 'continue';
      };
    });

    // Wait indefinitely-ish (but bounded) so operator can act
    await page.waitForTimeout(60000);
  } catch (e) {
    console.log('RUNNER ERROR:', e.message);
  } finally {
    // Save summary artifacts
    const summary = {
      consoleMsgs,
      consoleErrors,
      networkFailures,
      screenshots: [],
      timestamp: new Date().toISOString(),
      baseUrl: 'http://127.0.0.1:5173',
    };
    await page.evaluate((s) => {
      // stash in window for retrieval if needed
      window.__buffySummary = s;
    }, summary);

    await browser.close();
    console.log('DONE consoleErrors:', consoleErrors.length, 'networkFailures:', networkFailures.length);
  }
}

go().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
