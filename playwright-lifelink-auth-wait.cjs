const r = require('/home/daytona/codebase/node_modules/playwright/index.js');
const OUT = '/home/daytona/codebase/browser-screenshots/lifelink-transfer';
const APP = 'http://127.0.0.1:5173/auth?returnTo=/supply';
async function main() {
  const browser = await r.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  const url = page.url();
  const title = await page.title();
  console.log('URL:', url);
  console.log('TITLE:', title);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('BODY TEXT (first 1500):', bodyText.slice(0, 1500));
  const emailField = await page.locator('input[type=email]').isVisible().catch(() => false);
  const sendCodeBtn = await page.locator('button:has-text("Send verification code"), button:has-text("Send code")').first().isVisible().catch(() => false);
  console.log('email field visible:', emailField, '| send-code button visible:', sendCodeBtn);
  console.log('Awaiting manual sign-in in the browser (no OTP automation used).');
  const loggedIn = await page.waitForFunction(() => {
    const t = document.body ? document.body.innerText.toLowerCase() : '';
    return t.includes('supply') || t.includes('dashboard') || t.includes('blood requests') || t.includes('generate blood request') || t.includes('new blood request');
  }, { timeout: 600000 }).then(() => true).catch(() => false);
  if (loggedIn) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/02-signed-in.png`, fullPage: false });
    console.log('SCREENSHOT', `${OUT}/02-signed-in.png`);
    console.log('URL after sign-in:', page.url());
    const afterText = await page.locator('body').innerText().catch(() => '');
    console.log('BODY TEXT (after sign-in, first 1500):', afterText.slice(0, 1500));
    console.log('BROWSER_OPEN — signed-in state detected. Switch accounts manually and continue the transfer lifecycle.');
  } else {
    console.log('Sign-in not detected within wait window. Browser kept open for manual work; last snapshot above is auth page.');
  }
  await page.waitForTimeout(15000);
  await browser.close();
  console.log('DONE');
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
