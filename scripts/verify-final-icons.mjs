import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.webmanifest"), "utf8"));
const iconPaths = ["public/icons/icon-192.png", "public/icons/icon-512.png", "public/icons/apple-touch-icon.png"];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
const page = await context.newPage();

const iconResults = {};
for (const rel of iconPaths) {
  const bytes = fs.readFileSync(path.join(root, rel));
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  iconResults[rel] = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let white = 0;
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4;
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a > 0 && r > 150 && g < 110 && b < 110) {
          red += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        if (a > 0 && r > 245 && g > 245 && b > 245) white += 1;
      }
    }
    const pixel = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      cornerTopLeft: pixel(2, 2),
      cornerBottomRight: pixel(canvas.width - 3, canvas.height - 3),
      center: pixel(cx, cy),
      redPixels: red,
      whitePixels: white,
      redPixelPercent: Number(((red / (canvas.width * canvas.height)) * 100).toFixed(2)),
      redBounds: { minX, minY, maxX, maxY },
      contentCenter: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      canvasCenter: { x: cx, y: cy },
    };
  }, dataUrl);
}

const logoFiles = ["public/logo.svg", "src/assets/logo.svg"];
const logoHashes = {};
for (const rel of logoFiles) {
  logoHashes[rel] = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, rel)))
    .digest("hex");
}

await page.setContent(`<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif">
  <div style="padding:36px;display:flex;gap:40px;align-items:flex-start">
    <div>
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.12em;color:#6b7280">INSTALLED APP ICON</p>
      <div style="width:260px;height:260px;border-radius:54px;background:#fff;box-shadow:0 18px 45px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center">
        <img src="data:image/png;base64,${fs.readFileSync(path.join(root, "public/icons/icon-512.png")).toString("base64")}" style="width:232px;height:232px;border-radius:48px" />
      </div>
      <p style="margin:12px 0 0;font-size:12px;color:#374151">White rounded-square icon · 512×512</p>
    </div>
    <div>
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.12em;color:#6b7280">WEBSITE LOGO — UNCHANGED</p>
      <div style="width:260px;height:130px;border-radius:18px;background:#0b1f33;display:flex;align-items:center;justify-content:center">
        <img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(root, "public/logo.svg")).toString("base64")}" style="width:190px" />
      </div>
      <p style="margin:12px 0 0;font-size:12px;color:#374151">Original header logo asset</p>
    </div>
  </div></body></html>`);
await page.screenshot({
  path: "browser-screenshots/final-verification/app-icon-preview.png",
  fullPage: true,
});

const report = {
  manifest,
  manifestIconReferences: (manifest.icons ?? []).map((icon) => ({
    src: icon.src,
    sizes: icon.sizes,
    type: icon.type,
    purpose: icon.purpose,
    fileExists: fs.existsSync(path.join(root, "public", icon.src.replace(/^\//, ""))),
  })),
  indexHtmlAppleTouchIcon: fs
    .readFileSync(path.join(root, "index.html"), "utf8")
    .includes('rel="apple-touch-icon"'),
  iconResults,
  logoHashes,
};
fs.writeFileSync(
  "browser-screenshots/final-verification/icon-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
