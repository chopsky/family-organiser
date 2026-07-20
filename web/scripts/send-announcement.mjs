/**
 * Send the announcement email through Postmark on a BROADCAST stream.
 *
 * Postmark is a sender, not a campaign tool — it has no "select all users
 * and send" UI. You bring the recipient list (export from Supabase) and
 * this script sends to it via the batch API, on a broadcast stream, with
 * Postmark's managed unsubscribe.
 *
 * Safe by default: with no flag it DRY-RUNS (prints counts, sends nothing).
 *
 *   # 1. dry run — see how many, and a sample, send nothing
 *   POSTMARK_SERVER_TOKEN=xxx node scripts/send-announcement.mjs --file emails.csv
 *
 *   # 2. one test to yourself (renders exactly as recipients will see it)
 *   POSTMARK_SERVER_TOKEN=xxx node scripts/send-announcement.mjs --file emails.csv --test you@housemait.com
 *
 *   # 3. the real send (only when you're ready)
 *   POSTMARK_SERVER_TOKEN=xxx node scripts/send-announcement.mjs --file emails.csv --send
 *
 * --file  : .txt (one email per line) or .csv (email in any column). Header row ignored.
 * The token is read from the environment; this script never stores or prints it.
 */
import { readFileSync } from 'node:fs';

// ── Config: EDIT THESE before a real send ───────────────────────────────
const FROM = 'Housemait <updates@housemait.com>'; // must be on a verified Postmark domain
const SUBJECT = 'Housemait just got a big update';
const STREAM = 'broadcast'; // your Postmark BROADCAST message stream ID (not "outbound"/transactional)
const HTML_PATH = new URL('../../emails/announcement-2026-07.html', import.meta.url);
// ─────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || true) : null; };
const filePath = opt('--file');
const testTo = opt('--test');
const doSend = args.includes('--send');
const token = process.env.POSTMARK_SERVER_TOKEN;

if (!filePath) { console.error('Missing --file <recipients.csv|.txt>'); process.exit(1); }
if (!token) { console.error('Missing POSTMARK_SERVER_TOKEN env var'); process.exit(1); }

const html = readFileSync(HTML_PATH, 'utf8');
if (html.includes('REPLACE: your postal address')) {
  console.error('✋ The footer still has the address placeholder — edit emails/announcement-2026-07.html first (legal requirement).');
  process.exit(1);
}
if (!html.includes('{{{ pm:unsubscribe }}}')) {
  console.error('✋ No {{{ pm:unsubscribe }}} in the HTML — Postmark broadcast needs an unsubscribe link.');
  process.exit(1);
}

// Parse + dedupe + basic-validate recipient emails.
const EMAIL = /[^\s,;"']+@[^\s,;"']+\.[^\s,;"']+/;
const emails = [...new Set(
  readFileSync(filePath, 'utf8').split(/\r?\n/)
    .map((line) => (line.match(EMAIL) || [])[0])
    .filter(Boolean)
    .map((e) => e.trim().toLowerCase()),
)];
console.log(`Recipients: ${emails.length} unique valid addresses from ${filePath}`);
console.log(`Sample: ${emails.slice(0, 3).join(', ')}${emails.length > 3 ? ' …' : ''}`);
console.log(`From: ${FROM}   Stream: ${STREAM}   Subject: ${SUBJECT}`);

const message = (to) => ({
  From: FROM, To: to, Subject: SUBJECT, HtmlBody: html,
  MessageStream: STREAM, TrackOpens: true,
});

async function postBatch(batch) {
  const res = await fetch('https://api.postmarkapp.com/email/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Postmark-Server-Token': token },
    body: JSON.stringify(batch.map(message)),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Postmark ${res.status}: ${JSON.stringify(body)}`);
  const errs = body.filter((r) => r.ErrorCode !== 0);
  return { ok: body.length - errs.length, errs };
}

if (testTo) {
  console.log(`\nSending ONE test to ${testTo} …`);
  const { errs } = await postBatch([testTo]);
  console.log(errs.length ? `❌ ${JSON.stringify(errs)}` : '✅ Test sent. Check Gmail, Apple Mail and Outlook.');
  process.exit(0);
}

if (!doSend) {
  console.log('\nDRY RUN — nothing sent. Add --test <you@…> to preview, or --send to send for real.');
  process.exit(0);
}

// Real send: chunk into batches of 500 (Postmark's per-request limit).
console.log(`\n⚠️  REAL SEND to ${emails.length} recipients on stream "${STREAM}".`);
let sent = 0; const failures = [];
for (let i = 0; i < emails.length; i += 500) {
  const chunk = emails.slice(i, i + 500);
  const { ok, errs } = await postBatch(chunk);
  sent += ok; failures.push(...errs);
  console.log(`  batch ${i / 500 + 1}: ${ok}/${chunk.length} accepted${errs.length ? `, ${errs.length} failed` : ''}`);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`\nDone. Accepted: ${sent}. Failed: ${failures.length}.`);
if (failures.length) console.log(JSON.stringify(failures.slice(0, 10), null, 2));
