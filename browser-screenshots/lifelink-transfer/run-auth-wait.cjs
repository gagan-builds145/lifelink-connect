const pw = require('/home/daytona/codebase/node_modules/playwright/index.js');

const OUT = '/home/daytona/codebase/browser-screenshots/lifelink-transfer';
const APP = 'http://127.0.0.1:5173/auth?returnTo=/supply';

async function main() {
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });
  page.on('requestfailed', (req) => {
    networkFailures.push({ url: req.url(), failure: req.failure().reason });
  });

  let n = 0;
  const snap = async (name) => {
    n++;
    const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log('SCREENSHOT', file);
    return file;
  };

  try {
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
    await snap('auth-open');
    console.log('URL after load:', page.url());

    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log('BODY TEXT (first 1500):', bodyText.slice(0, 1500));

    // Detect the email OTP screen fields
    const emailField = await page.locator('input[type=email]').isVisible().catch(() => false);
    const sendCodeBtn = await page.locator('button:has-text("Send verification code"), button:has-text("Send code"), button:has-text("Send"), span:has-text("Send verification code")').first().isVisible().catch(() => false);
    console.log('email field visible:', emailField, '| send-code-ish button visible:', sendCodeBtn);

    // Keep browser alive for manual sign-in
    console.log('Awaiting manual sign-in in the browser (no OTP automation used).');
    // Wait up to 10 minutes for dashboard-ish content to appear; do not clear cookies.
    const loggedIn = await page.waitForFunction(
      () => {
        const t = document.body ? document.body.innerText.toLowerCase() : '';
        return t.includes('supply') || t.includes('dashboard') || t.includes('blood requests') || t.includes('generate blood request') || t.includes('new blood request');
      },
      { timeout: 600000 }
    ).then(() => true).catch(() => false);

    if (loggedIn) {
      await page.waitForTimeout(1500);
      await snap('signed-in');
      console.log('URL after sign-in:', page.url());
      const afterText = await page.locator('body').innerText().catch(() => '');
      console.log('BODY TEXT (after sign-in, first 1500):', afterText.slice(0, 1500));
      console.log('BROWSER_OPEN — signed-in state detected. Switch accounts manually and continue the transfer lifecycle.');
    } else {
      console.log('Sign-in not detected within wait window. Browser kept open for manual work; last snapshot above is auth page.');
    }

    // Keep browser open a bit longer so operator can act if needed
    await page.waitForTimeout(15000);
  } catch (e) {
    console.log('RUNNER ERROR:', e.message);
  } finally {
    console.log('SUMMARY consoleErrors:', consoleErrors.length, 'networkFailures:', networkFailures.length);
    if (consoleErrors.length) {
      console.log('CONSOLE ERRORS:');
      consoleErrors.forEach((e) => console.log(' -', e));
    }
    if (networkFailures.length) {
      console.log('NETWORK FAILURES:');
      networkFailures.forEach((f) => console.log(' -', f.url, f.failure));
    }
    await browser.close();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
