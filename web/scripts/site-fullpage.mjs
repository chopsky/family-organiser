/**
 * Single full-page screenshot of the marketing site at 1440 CSS px @2x
 * (2880px-wide image), using the ?flat=1 screenshot mode so the scroll
 * story renders as stacked chapters instead of an empty 660vh rail.
 *
 * Chrome's compositor caps a single capture at 16384 device px; a full
 * flat page at @2x exceeds that, so the page is captured in slices and
 * stitched in an offscreen <canvas> inside the same browser.
 *
 * Usage: node scripts/site-fullpage.mjs [url]
 *   default url: http://localhost:5173/gb?flat=1  (dev server)
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL_ARG = process.argv[2] || 'http://localhost:5173/gb?flat=1';
const OUT_DIR = '/Users/grantshapiro/family-organiser/site-screenshots';
const OUT = `${OUT_DIR}/full-page.png`;
const WIDTH = 1440;
const DSF = 2;
const SLICE = 6000; // CSS px per slice (12000 device px, safely under 16384)

mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: DSF });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('housemait-analytics-consent', 'declined'); } catch { /* */ }
});
await page.goto(URL_ARG, { waitUntil: 'networkidle0', timeout: 60000 });

// Neutralise scroll-reveals (a single-paint capture never scrolls, so
// anything still .pre would render invisible) and force lazy images to
// load — captureBeyondViewport never triggers lazy loading, which left
// below-fold mocks as blank rectangles.
await page.evaluate(async () => {
  document.querySelectorAll('[data-lv-reveal]').forEach((n) => { n.classList.remove('pre'); n.classList.add('in') });
  document.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager' });
  await Promise.all([...document.images].map((img) => img.complete ? null : img.decode().catch(() => {})));
});
await new Promise((r) => setTimeout(r, 600)); // fonts + paint settle

const totalH = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
console.log(`page: ${WIDTH}x${totalH} CSS px -> image ${WIDTH * DSF}x${totalH * DSF}`);

// Capture slices (clip is in CSS px; captureBeyondViewport avoids scrolling).
const slices = [];
for (let y = 0; y < totalH; y += SLICE) {
  const h = Math.min(SLICE, totalH - y);
  const buf = await page.screenshot({
    clip: { x: 0, y, width: WIDTH, height: h },
    captureBeyondViewport: true,
  });
  slices.push({ y, h, b64: Buffer.from(buf).toString('base64') });
  console.log(`  slice @${y} (${h} CSS px)`);
}

// Stitch in-browser on a canvas and export one PNG.
const dataUrl = await page.evaluate(async ({ slices, width, totalH, dsf }) => {
  const canvas = document.createElement('canvas');
  canvas.width = width * dsf;
  canvas.height = totalH * dsf;
  const ctx = canvas.getContext('2d');
  for (const s of slices) {
    const img = new Image();
    img.src = `data:image/png;base64,${s.b64}`;
    await img.decode();
    ctx.drawImage(img, 0, s.y * dsf);
  }
  return canvas.toDataURL('image/png');
}, { slices, width: WIDTH, totalH, dsf: DSF });

writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
await browser.close();
console.log(`done -> ${OUT}`);
