/**
 * Regenerates the static store-link QR SVGs in web/public/assets so both
 * codes share identical geometry. The previous pair came from different
 * online generators: the App Store one baked a 4-module quiet zone into its
 * canvas while the Play one filled it edge-to-edge, so at the same CSS size
 * the iOS code painted ~20% smaller (real report 2026-08-06).
 *
 * Same matrix→path approach as web/src/components/QrCode.jsx, same library.
 * Re-run whenever a store URL changes:
 *
 *   node web/scripts/generate-store-qrs.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeQR } from '@paulmillr/qr';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

// Mirrors web/src/lib/app-store.js (a .mjs script can't import the JSX-adjacent
// lib directly without a build step; keep in sync).
const APP_STORE_URL = 'https://apps.apple.com/app/housemait/id6762131562';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.housemait.app';

// 2-module baked-in quiet zone: the popover's white padding supplies the rest
// of the spec's 4, and a smaller border maximises the dark area at any CSS size.
const QUIET = 2;
const DARK = '#2D2A33'; // charcoal, matching QrCode.jsx — functional contrast, not themed

// Both codes are pinned to the SAME QR version (grid size): the Play URL is
// longer than the App Store one, so left to auto-size the two codes come out
// at different module densities and read as mismatched sizes side by side
// (real report 2026-08-06, twice). Encode each once to find its natural
// version, then re-encode both at the larger of the two.
function naturalVersion(value) {
  const n = encodeQR(value, 'raw', { ecc: 'medium', border: 0 }).length;
  return (n - 17) / 4;
}

function svgFor(value, version) {
  const cells = encodeQR(value, 'raw', { ecc: 'medium', border: 0, version });
  const n = cells.length;
  let d = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!cells[y][x]) { x += 1; continue; }
      let run = 1;
      while (x + run < n && cells[y][x + run]) run += 1;
      d += `M${x} ${y}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const span = n + QUIET * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="${-QUIET} ${-QUIET} ${span} ${span}" shape-rendering="crispEdges"><path fill="#fff" d="M${-QUIET} ${-QUIET}h${span}v${span}H${-QUIET}z"/><path fill="${DARK}" d="${d}"/></svg>\n`;
}

const version = Math.max(naturalVersion(APP_STORE_URL), naturalVersion(PLAY_STORE_URL));
for (const [file, url] of [
  ['app-store-qr.svg', APP_STORE_URL],
  ['play-store-qr.svg', PLAY_STORE_URL],
]) {
  writeFileSync(join(ASSETS, file), svgFor(url, version));
  console.log(`wrote ${file} (${url}) at version ${version}`);
}
