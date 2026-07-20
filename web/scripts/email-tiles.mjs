/**
 * Bake the 4 email feature images: each app screenshot placed inside the
 * phone frame on a soft branded gradient tile, with a drop shadow —
 * exported as a single JPG. Baking the rounded corners / shadow / frame
 * into the image means it renders identically in every email client
 * (Gmail, Outlook and co. don't support border-radius or box-shadow).
 *
 * Output -> web/public/email/feat-*.jpg (served at housemait.com/email/).
 * Run: cd web && node scripts/email-tiles.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const OUT = join(PUB, 'email');
mkdirSync(OUT, { recursive: true });

// data: URI helper so the single rendered page needs no server/file access.
const dataUri = (rel, mime) => `data:${mime};base64,${readFileSync(join(PUB, rel)).toString('base64')}`;
const FRAME = dataUri('landing/phone-frame.webp', 'image/webp');

// feature key, screen image, tile gradient (top -> bottom)
const TILES = [
  ['feat-chores', 'landing/app-tasks.jpg', '#F3EDFC', '#FBF8F3'],
  ['feat-rewards', 'landing/app-rewards.jpg', '#FDF0EB', '#FBF8F3'],
  ['feat-lists', 'landing/app-lists.jpg', '#EDF5EE', '#FBF8F3'],
  ['feat-childmode', 'landing/app-kid-quests.jpg', '#FBEAF3', '#FBF8F3'],
];

// Tile 720x1180 CSS px, rendered @2x -> 1440x2360. Phone frame 520px wide
// (aspect 828/1728), centred, soft shadow. Screen inset matches the site's
// .lv-screen (4.71% sides, 2.66% top/bottom, 8.5%/3.9% radius).
const html = (screen, top, bottom) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 720px; height: 1180px; }
  .tile { width: 720px; height: 1180px; background: linear-gradient(${top}, ${bottom});
          display: flex; align-items: center; justify-content: center; }
  .frame { position: relative; width: 520px; aspect-ratio: 828/1728;
           filter: drop-shadow(0 26px 46px rgba(60, 32, 92, 0.30)); }
  .frame-img { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 10; }
  .screen { position: absolute; left: 4.71%; right: 4.71%; top: 2.66%; bottom: 2.66%;
            border-radius: 8.5% / 3.9%; overflow: hidden; background: #FBF8F3; }
  .screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style></head><body>
  <div class="tile"><div class="frame">
    <div class="screen"><img src="${screen}"></div>
    <img class="frame-img" src="${FRAME}">
  </div></div>
</body></html>`;

const browser = await puppeteer.launch({
  channel: 'chrome', headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1180, deviceScaleFactor: 2 });
  for (const [key, screen, top, bottom] of TILES) {
    await page.setContent(html(dataUri(screen, 'image/jpeg'), top, bottom), { waitUntil: 'load' });
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    const buf = await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 720, height: 1180 } });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(OUT, `${key}.jpg`), buf);
    console.log(`  ${key}.jpg  (${(buf.length / 1024).toFixed(0)}kB)`);
  }
} finally {
  await browser.close();
}
console.log('done ->', OUT);
