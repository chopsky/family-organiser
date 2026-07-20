// Capture marketing screenshots of housemait.com section-by-section,
// driving the scroll story to each chapter's mid-state.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const OUT = '/Users/grantshapiro/family-organiser/site-screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-device-scale-factor=2', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('housemait-analytics-consent', 'declined'); } catch { /* */ }
});
await page.goto('https://housemait.com/gb', { waitUntil: 'networkidle0', timeout: 60000 });

// Story scroll position for progress p
const storyTop = await page.evaluate(() => {
  const st = document.getElementById('story');
  return st.getBoundingClientRect().top + window.scrollY;
});
const storyTotal = await page.evaluate(() => {
  const st = document.getElementById('story');
  return st.offsetHeight - window.innerHeight;
});

const scrollTo = async (y) => {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), Math.round(y));
  await new Promise((r) => setTimeout(r, 1100)); // reveals (0.7s) + rAF settle
};
const anchorY = (sel, offset = -40) => page.evaluate((s, o) => {
  const el = document.querySelector(s);
  return el.getBoundingClientRect().top + window.scrollY + o;
}, sel, offset);

const shots = [
  ['01-hero', 0],
  ['02-story-icons', storyTop + storyTotal * 0.01],
  ['03-story-calendar', storyTop + storyTotal * 0.27],
  ['04-story-chores', storyTop + storyTotal * 0.43],
  ['05-story-meals', storyTop + storyTotal * 0.59],
  ['06-story-lists', storyTop + storyTotal * 0.75],
  ['07-story-whatsapp', storyTop + storyTotal * 0.93],
];
for (const [name, y] of shots) {
  await scrollTo(y);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}`);
}
for (const [name, sel] of [
  ['08-features', '#touches'], ['09-reviews', '#reviews'], ['10-privacy', '#privacy'],
  ['11-pricing', '#pricing'], ['12-faq', '#faq'], ['13-download-cta', '#download'],
]) {
  await scrollTo(await anchorY(sel));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}`);
}
await browser.close();
console.log('done ->', OUT);
