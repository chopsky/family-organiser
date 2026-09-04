#!/usr/bin/env node
/**
 * Build the September 2026 user survey as a Tally form, through Tally's
 * API, so nobody has to click forty questions into the editor by hand.
 *
 * Source of truth for the wording: docs/survey-2026-09.md. The structure
 * here mirrors it section for section. Change the doc, then this file.
 *
 * Usage:
 *   node web/scripts/tally-survey.mjs --dry-run           # writes the JSON, posts nothing
 *   TALLY_API_KEY=... node web/scripts/tally-survey.mjs   # creates the form (DRAFT)
 *   TALLY_API_KEY=... node web/scripts/tally-survey.mjs --publish
 *   ... --no-logic   # skip the branching rules (add them in the editor)
 *
 * The API key is created at tally.so/settings/api-keys (free plan is fine)
 * and is read ONLY from the environment. Never paste it into this file.
 *
 * Block conventions, verified against developers.tally.so on 2026-09-03:
 *   - A question is a TITLE block (groupType QUESTION, its own group)
 *     followed by the input block(s) in THEIR own group.
 *   - Single choice: one MULTIPLE_CHOICE_OPTION block per option, all
 *     sharing a groupUuid with groupType MULTIPLE_CHOICE. Tick-all-that-
 *     apply is the same shape with CHECKBOX / CHECKBOXES.
 *   - Matrix: a MATRIX block plus MATRIX_ROW and MATRIX_COLUMN blocks, all
 *     sharing the MATRIX group.
 *   - HIDDEN_FIELDS declares URL-parameter fields (email, seg).
 *   - PAGE_BREAK splits sections; the last one is the thank-you page.
 *   - CONDITIONAL_LOGIC carries conditionals + actions. Its field/value
 *     semantics are the one part the public docs leave implicit, so the
 *     rules are generated in a separate pass and can be disabled.
 */
import { randomUUID as uuid } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const PUBLISH = args.has('--publish');
const LOGIC = !args.has('--no-logic');

// ── tiny block builders ─────────────────────────────────────────────────────

const blocks = [];
const refs = {}; // named handles for logic: refs.q1 = { group, options: {text: uuid} }

function formTitle(text) {
  blocks.push({ uuid: uuid(), type: 'FORM_TITLE', groupUuid: uuid(), groupType: 'TEXT', payload: { title: text, html: text } });
}
function text(html) {
  blocks.push({ uuid: uuid(), type: 'TEXT', groupUuid: uuid(), groupType: 'TEXT', payload: { html } });
}
function title(html) {
  blocks.push({ uuid: uuid(), type: 'TITLE', groupUuid: uuid(), groupType: 'QUESTION', payload: { html } });
}
function pageBreak({ thankYou = false } = {}) {
  const b = { uuid: uuid(), type: 'PAGE_BREAK', groupUuid: uuid(), groupType: 'PAGE_BREAK', payload: { index: 0, isFirst: false, isLast: false, ...(thankYou ? { isThankYouPage: true } : {}) } };
  blocks.push(b);
  return b.uuid;
}
function hiddenFields(names) {
  blocks.push({ uuid: uuid(), type: 'HIDDEN_FIELDS', groupUuid: uuid(), groupType: 'HIDDEN_FIELDS', payload: { hiddenFields: names.map((name) => ({ uuid: uuid(), name })) } });
}

/** Single choice (or tick-all with multi=true). Returns a ref for logic. */
function choice(key, question, options, { multi = false, required = true, other = false } = {}) {
  title(question);
  const group = uuid();
  const type = multi ? 'CHECKBOX' : 'MULTIPLE_CHOICE_OPTION';
  const groupType = multi ? 'CHECKBOXES' : 'MULTIPLE_CHOICE';
  const ref = { group, options: {} };
  const list = other ? [...options, 'Something else'] : options;
  list.forEach((opt, i) => {
    const id = uuid();
    ref.options[opt] = id;
    blocks.push({
      uuid: id, type, groupUuid: group, groupType,
      payload: {
        index: i, isFirst: i === 0, isLast: i === list.length - 1,
        text: opt, name: key,
        ...(i === 0 ? { isRequired: required } : {}),
        ...(other && i === list.length - 1 ? { isOtherOption: true, hasOtherOption: true } : {}),
      },
    });
  });
  refs[key] = ref;
  return ref;
}

/** Grid: one answer per row. */
function matrix(key, question, rows, columns, { required = true } = {}) {
  title(question);
  const group = uuid();
  blocks.push({ uuid: uuid(), type: 'MATRIX', groupUuid: group, groupType: 'MATRIX', payload: { isRequired: required, name: key } });
  const ref = { group, rows: {}, columns: {} };
  rows.forEach((r, i) => { const id = uuid(); ref.rows[r] = id; blocks.push({ uuid: id, type: 'MATRIX_ROW', groupUuid: group, groupType: 'MATRIX', payload: { index: i, isFirst: i === 0, isLast: i === rows.length - 1, text: r, html: r } }); });
  columns.forEach((c, i) => { const id = uuid(); ref.columns[c] = id; blocks.push({ uuid: id, type: 'MATRIX_COLUMN', groupUuid: group, groupType: 'MATRIX', payload: { index: i, isFirst: i === 0, isLast: i === columns.length - 1, text: c, html: c } }); });
  refs[key] = ref;
  return ref;
}

function longText(key, question, { required = false, placeholder = '' } = {}) {
  title(question);
  blocks.push({ uuid: uuid(), type: 'TEXTAREA', groupUuid: uuid(), groupType: 'TEXTAREA', payload: { isRequired: required, placeholder, name: key } });
}
function email(key, question, { required = false } = {}) {
  title(question);
  blocks.push({ uuid: uuid(), type: 'INPUT_EMAIL', groupUuid: uuid(), groupType: 'INPUT_EMAIL', payload: { isRequired: required, placeholder: 'you@example.com', name: key } });
}

/** Branching: show a group of blocks only when a choice answer matches. */
function showWhen(ref, optionText, blockUuids) {
  const optionUuid = ref.options[optionText];
  if (!optionUuid) throw new Error(`no option "${optionText}"`);
  blocks.push({
    uuid: uuid(), type: 'CONDITIONAL_LOGIC', groupUuid: uuid(), groupType: 'CONDITIONAL_LOGIC',
    payload: {
      conditionals: [{ uuid: uuid(), type: 'SINGLE', payload: { field: { uuid: optionUuid, blockGroupUuid: ref.group, title: optionText, payload: {} }, value: optionUuid } }],
      actions: [{ uuid: uuid(), payload: { showBlocks: blockUuids } }],
    },
  });
}

// Record which block uuids belong to a "section" so logic can show/hide them.
function section(fn) {
  const start = blocks.length;
  fn();
  return blocks.slice(start).map((b) => b.uuid);
}

// ── the survey (mirrors docs/survey-2026-09.md) ─────────────────────────────

formTitle('A few quick questions about Housemait');
hiddenFields(['email', 'seg']);
text('A few quick questions from Grant, who builds Housemait. About three minutes. I read every answer myself, and the next things I build will come from what people tell me here. Everyone who finishes gets 30 days of Premium, and one household wins a £100 John Lewis voucher.');

const q1 = choice('q1_frequency', 'How often do you open Housemait at the moment?', [
  'Most days', 'A few times a week', 'About once a week', 'Less than that', "I've stopped using it",
]);

choice('q2_most_useful', 'Which ONE thing has been most useful for your family so far?', [
  'The shared calendar', 'The WhatsApp assistant', 'Shopping and to-do lists', 'Meal planning',
  'School term dates', 'Chores, stars and Kids mode', 'The assistant in the app (the sparkle button)', 'Nothing has really stuck yet',
]);

choice('q3_pmf', 'How would you feel if you could no longer use Housemait?', [
  'Very disappointed', 'Somewhat disappointed', 'Not disappointed', "I haven't used it enough to say",
]);

const FEATURES = ['The WhatsApp assistant', 'Connecting your Apple, Google or Outlook calendar', 'School term dates', 'Meal planning', 'Kids mode, chores and stars', 'The assistant in the app (the sparkle button)'];
const GRID = ['I use it', 'Tried it, then stopped', 'Knew about it, never tried', "Didn't know it existed"];
matrix('q4_features', 'For each of these, which is closest to the truth?', FEATURES, GRID);

// The grid answer can't drive logic reliably through the API, so the two
// WhatsApp follow-ups hinge on one plain question instead.
pageBreak();
const wa = choice('q4b_whatsapp', 'And the WhatsApp assistant specifically: which is closest?', GRID);

const waNever = section(() => {
  choice('q5_wa_why_not', "What's the main reason you haven't connected WhatsApp?", [
    "I didn't know it existed", "I'm not sure what it would actually do for me", "I'd rather just use the app",
    "I don't want to give an app my WhatsApp", 'I tried and couldn\'t get it working',
  ], { other: true });
});
const waUsed = section(() => {
  choice('q6_wa_used_for', 'What have you mostly sent it?', [
    'Events and appointments', 'Shopping list items', 'Questions like "what\'s on tomorrow?"', 'Photos of school letters', 'Voice notes', 'Not much yet',
  ], { multi: true, required: false });
  longText('q6b_wa_frustrations', 'Anything it got wrong, or that frustrated you?');
});

pageBreak();
const cal = choice('q7a_calendar', 'And connecting your existing calendar: which is closest?', GRID);
const calNever = section(() => {
  choice('q7_cal_why_not', 'What stopped you connecting your existing calendar?', [
    "I didn't know I could", "I wasn't sure it would stay in sync", 'I was worried it would duplicate things or make a mess',
    "I just didn't get round to it", "I tried and it didn't work", "I don't use another calendar",
  ]);
});

pageBreak();
choice('q8_premium_aware', 'Did you know Housemait has a Premium plan?', ['Yes', 'No']);
choice('q9_premium_why_not', "What's the main reason you're not on Premium?", [
  'The free plan gives me everything I need', "I don't know what Premium actually adds", "It's too expensive",
  "I'm still deciding", "I haven't found the app useful enough to pay for",
], { other: true });
choice('q10_price', 'For unlimited use of the assistant, what would feel like a fair monthly price?', [
  "I wouldn't pay for it", 'Up to £2', '£2 to £4', '£4 to £6', '£6 to £10', 'More than £10',
]);

pageBreak();
const lapsed = section(() => {
  choice('q11_why_stopped', "What's the main reason you stopped?", [
    "It didn't do what I hoped", 'Too much effort to set up', "The rest of the family didn't use it",
    'I forgot it was there', 'I found something else that worked better',
  ], { other: true, required: false });
  longText('q11b_what_would_keep', 'What would have kept you?');
});

pageBreak();
longText('q12_essential', 'What ONE thing would make Housemait essential for your family?');
longText('q13_anything_else', "Anything else you'd like to tell me?");
choice('q14_interview', "Would you be up for a 15-minute chat about how you use it? I'll add another 30 days of Premium as a thank you.", ['Yes, email me', 'No thanks'], { required: false });
email('q14b_email', 'Best email to reach you on', { required: false });

pageBreak({ thankYou: true });
text("Thank you. Your 30 days of Premium will land within a couple of days, and I'll email the voucher winner at the end of the month. Grant.");

// ── branching ───────────────────────────────────────────────────────────────
if (LOGIC) {
  for (const opt of ['Knew about it, never tried', "Didn't know it existed"]) showWhen(wa, opt, waNever);
  for (const opt of ['I use it', 'Tried it, then stopped']) showWhen(wa, opt, waUsed);
  for (const opt of ['Knew about it, never tried', "Didn't know it existed"]) showWhen(cal, opt, calNever);
  for (const opt of ['Less than that', "I've stopped using it"]) showWhen(q1, opt, lapsed);
}

// ── ship it ─────────────────────────────────────────────────────────────────
const form = { name: 'Housemait survey, September 2026', status: PUBLISH ? 'PUBLISHED' : 'DRAFT', blocks };
const out = new URL('../../docs/survey-2026-09.tally.json', import.meta.url);
writeFileSync(out, JSON.stringify(form, null, 2));
const counts = blocks.reduce((m, b) => ((m[b.type] = (m[b.type] || 0) + 1), m), {});
console.log(`${blocks.length} blocks →`, counts);
console.log(`JSON written to ${out.pathname}`);

if (DRY) process.exit(0);

const key = process.env.TALLY_API_KEY;
if (!key) { console.error('TALLY_API_KEY is not set. Create one at tally.so/settings/api-keys and export it.'); process.exit(1); }

const res = await fetch('https://api.tally.so/forms', {
  method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(form),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`Tally said ${res.status}:`, JSON.stringify(body, null, 2)); process.exit(1); }
console.log(`Created form ${body.id} (${body.status}) → https://tally.so/forms/${body.id}/edit`);

// Read it back so the founder can see what survived (logic especially).
const check = await fetch(`https://api.tally.so/forms/${body.id}/questions`, { headers: { Authorization: `Bearer ${key}` } });
const qs = await check.json().catch(() => null);
if (Array.isArray(qs)) console.log(`Tally reports ${qs.length} questions.`);
else if (qs?.items) console.log(`Tally reports ${qs.items.length} questions.`);
