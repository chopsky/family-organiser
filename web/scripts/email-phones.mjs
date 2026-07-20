/**
 * Transparent phone PNGs for the redesigned announcement email, where the
 * coloured card sits behind the device (so the phone needs a transparent
 * background, unlike the baked tiles in email-tiles.mjs).
 *
 * Each app screenshot is placed inside the phone frame and exported as a
 * PNG with no background (screenshot omitBackground), at 2x the 230px
 * display width -> 460x960. Hosted at housemait.com/email/feat-*.png.
 * Run: cd web && node scripts/email-phones.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const OUT = join(PUB, 'email');
mkdirSync(OUT, { recursive: true });
const dataUri = (rel, mime) => `data:${mime};base64,${readFileSync(join(PUB, rel)).toString('base64')}`;
const FRAME = dataUri('landing/phone-frame.webp', 'image/webp');

const PHONES = [
  ['feat-chores', 'landing/app-tasks.jpg'],
  ['feat-rewards', 'landing/app-rewards.jpg'],
  ['feat-lists', 'landing/app-lists.jpg'],
  ['feat-childmode', 'landing/app-kid-quests.jpg'],
];

// Frame 828/1728. Render at 460px wide (2x of 230 display) -> 960 tall.
const html = (screen) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  .frame { position: relative; width: 460px; height: 960px; }
  .frame-img { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 10; }
  .screen { position: absolute; left: 4.71%; right: 4.71%; top: 2.66%; bottom: 2.66%;
            border-radius: 8.5% / 3.9%; overflow: hidden; background: #FBF8F3; }
  .screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style></head><body>
  <div class="frame">
    <div class="screen"><img src="${screen}"></div>
    <img class="frame-img" src="${FRAME}">
  </div>
</body></html>`;

const browser = await puppeteer.launch({
  channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb'],
});
try {
  const page = await browser.newPage();
  // deviceScaleFactor 1 because the CSS is already at 2x pixel dimensions.
  await page.setViewport({ width: 460, height: 960, deviceScaleFactor: 1 });
  for (const [key, screen] of PHONES) {
    await page.setContent(html(dataUri(screen, 'image/jpeg')), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    const el = await page.$('.frame');
    const buf = await el.screenshot({ type: 'png', omitBackground: true });
    writeFileSync(join(OUT, `${key}.png`), buf);
    console.log(`  ${key}.png  (${(buf.length / 1024).toFixed(0)}kB)`);
  }
} finally {
  await browser.close();
}
console.log('done ->', OUT);
