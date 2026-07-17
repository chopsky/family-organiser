/**
 * Post-build prerender for the marketing routes.
 *
 * Loads each route from the freshly built dist/ in headless Chrome and
 * snapshots the rendered DOM, so the static HTML that Vercel serves
 * contains exactly what our client JS produces: the page content, the
 * per-locale <title>/<meta name="description">, hreflang + canonical
 * tags, and the JSON-LD blocks. Googlebot's FIRST (non-JS) pass then
 * sees a full page instead of an empty <div id="root">.
 *
 * The SPA still boots on top of the snapshot: every head effect in the
 * app is idempotent (title/desc are set-not-appended, HreflangTags
 * wipes-and-recreates its marked tags, the JSON-LD injector is
 * find-or-create), so booting React over prerendered HTML produces no
 * duplicates. createRoot().render() replaces the #root children with
 * identical markup - no visible flash.
 *
 * Output layout (Vercel serves filesystem-first, with cleanUrls):
 *   /          -> dist/index.html   (overwritten with the snapshot)
 *   /gb        -> dist/gb.html      (cleanUrls maps /gb -> gb.html)
 *   ... one file per locale + support/privacy/terms
 *   SPA shell  -> dist/app.html     (pristine pre-snapshot index.html;
 *                 vercel.json's catch-all rewrite points here so app
 *                 routes like /dashboard never flash landing content)
 *
 * Runs as part of `npm run build`, locally and on Vercel. Chrome
 * sourcing differs by environment: Vercel's Amazon Linux build image
 * lacks Chrome's shared system libraries (a stock download dies with
 * "libnspr4.so: cannot open shared object file", exit 127), so on
 * Vercel we launch @sparticuz/chromium - a Chromium compiled for that
 * exact environment with its libraries bundled. Locally we use the
 * system-installed Chrome via puppeteer-core's channel resolution.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Route -> output file (relative to dist/). '/' overwrites index.html
// LAST, after all snapshots are captured, so the static server keeps
// serving the pristine shell while other routes render.
const ROUTES = [
  ['/', 'index.html'],
  ['/gb', 'gb.html'],
  ['/us', 'us.html'],
  ['/eu', 'eu.html'],
  ['/au', 'au.html'],
  ['/ca', 'ca.html'],
  ['/za', 'za.html'],
  ['/support', 'support.html'],
  ['/privacy', 'privacy.html'],
  ['/terms', 'terms.html'],
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

/** Tiny static server over dist/ with SPA fallback to the shell. */
function serveDist() {
  const shell = readFileSync(join(DIST, 'index.html'));
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = join(DIST, urlPath);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
      res.end(readFileSync(filePath));
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.end(shell);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** Post-process a snapshot before writing it. */
function clean(html) {
  return html
    // Reveal-on-scroll elements were captured pre-reveal (opacity 0 /
    // translated). Strip the .pre token so the static HTML shows all
    // content visible - the SPA re-runs the reveal init on boot anyway.
    .replace(/class="([^"]*)\bpre\b([^"]*)"/g, (m, a, b) => `class="${(a + b).trim().replace(/\s+/g, ' ')}"`)
    // The marquee may have been captured mid-translate; reset it.
    .replace(/(class="lv-marquee[^"]*" style=")[^"]*(")/, '$1$2');
}

const t0 = Date.now();
const { server, port } = await serveDist();

// Preserve the pristine shell for the SPA catch-all BEFORE anything
// overwrites index.html. vercel.json rewrites app routes here.
copyFileSync(join(DIST, 'index.html'), join(DIST, 'app.html'));

const browser = await puppeteer.launch(
  process.env.VERCEL === '1'
    ? {
        headless: true,
        args: chromium.args, // includes --no-sandbox etc. for the root build container
        executablePath: await chromium.executablePath(),
      }
    : {
        headless: true,
        channel: 'chrome', // locally: the system-installed Chrome
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      },
);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  // A recorded consent choice keeps the cookie banner out of the
  // snapshots ("declined" also keeps GA in cookieless ping mode).
  // Real visitors have their own (empty) localStorage - they still
  // get the banner.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('housemait-analytics-consent', 'declined'); } catch { /* no-op */ }
  });
  // Block third-party requests (fonts, GA, Turnstile): they slow the
  // build and play no part in the DOM we snapshot - their <script>/
  // <link> tags remain in the HTML untouched.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const host = new URL(req.url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost') req.continue();
    else req.abort();
  });

  const outputs = [];
  for (const [route, file] of ROUTES) {
    await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle0', timeout: 30000 });
    // Let mount effects (title/meta/hreflang/JSON-LD injection) settle.
    await page.waitForFunction(
      () => document.title.length > 0 && document.querySelector('#root > *'),
      { timeout: 10000 },
    );
    const html = await page.content();
    outputs.push([file, clean(html)]);
    console.log(`  prerendered ${route} -> ${file} (${(html.length / 1024).toFixed(0)}kB, title: ${await page.title()})`);
  }
  // Write everything only after every capture succeeded, so a failed
  // route can't leave dist/ half-prerendered.
  for (const [file, html] of outputs) writeFileSync(join(DIST, file), html);
} finally {
  await browser.close();
  server.close();
}

console.log(`Prerendered ${ROUTES.length} routes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
