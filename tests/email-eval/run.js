#!/usr/bin/env node
/**
 * Email AI eval suite.
 *
 * Replays a fixture corpus through the inbound-email pipeline's two AI
 * stages — `extractFromEmail` (classification + structured extraction)
 * and `matchReceiptToList` (fuzzy matching) — and asserts each output
 * against an expectation file.
 *
 * This is NOT a unit test suite. It calls the live AI providers
 * (Gemini / Claude / GPT) which means:
 *   • Real money per run (~$0.001–$0.005 per fixture call).
 *   • Slow — each call is 2-15 seconds.
 *   • Slightly non-deterministic — outputs vary run-to-run, so the
 *     expectation format below is intentionally loose (structural
 *     assertions + substring matches, not byte-equality).
 *
 * Run from the repo root:
 *   npm run eval:emails                          (full suite)
 *   npm run eval:emails -- --only=tesco         (filter by name substring)
 *   npm run eval:emails -- --only=receipt-match (just one stage)
 *   npm run eval:emails -- --verbose            (print AI responses)
 *
 * Exit code: 0 if all pass, 1 if any fail. Wired into pre-push / CI
 * to catch prompt regressions before they ship.
 *
 * Fixture layout:
 *   fixtures/
 *     extraction/<name>/
 *       input.json        { subject, text, members? }
 *       expected.json     { email_type?, shopping_items?, events?, tasks? }
 *     receipt-match/<name>/
 *       input.json        { receiptItems[], shoppingList[] }
 *       expected.json     { matches[], no_match_for? }
 *
 * Expectation format: only declare what matters. Each top-level key is
 * optional. See README.md for the full schema and rationale.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { extractFromEmail, matchReceiptToList } = require('../../src/services/ai');

// ── CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.toLowerCase() || '';
const VERBOSE = args.includes('--verbose');

// ── Helpers ─────────────────────────────────────────────────────────

function loadFixtures(subdir) {
  const dir = path.join(__dirname, 'fixtures', subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => fs.statSync(path.join(dir, name)).isDirectory())
    .filter((name) => !ONLY || (`${subdir}/${name}`).toLowerCase().includes(ONLY))
    .map((name) => {
      const inputPath = path.join(dir, name, 'input.json');
      const expectedPath = path.join(dir, name, 'expected.json');
      return {
        name,
        kind: subdir,
        input: JSON.parse(fs.readFileSync(inputPath, 'utf8')),
        expected: JSON.parse(fs.readFileSync(expectedPath, 'utf8')),
      };
    });
}

/**
 * Check a single field against an expectation block.
 * Returns array of failure messages (empty = passed).
 */
function checkBlock(actualArray, expBlock, fieldName) {
  if (!expBlock) return [];
  const failures = [];
  const count = (actualArray || []).length;
  if (expBlock.count_min != null && count < expBlock.count_min) {
    failures.push(`${fieldName}.count = ${count}, expected >= ${expBlock.count_min}`);
  }
  if (expBlock.count_max != null && count > expBlock.count_max) {
    failures.push(`${fieldName}.count = ${count}, expected <= ${expBlock.count_max}`);
  }
  if (expBlock.exact_count != null && count !== expBlock.exact_count) {
    failures.push(`${fieldName}.count = ${count}, expected exactly ${expBlock.exact_count}`);
  }
  // Substring checks: must_contain looks at any item's serialised text.
  const haystack = (actualArray || []).map((x) => JSON.stringify(x).toLowerCase()).join(' || ');
  for (const needle of expBlock.must_contain || []) {
    if (!haystack.includes(needle.toLowerCase())) {
      failures.push(`${fieldName} must contain "${needle}" but didn't`);
    }
  }
  for (const needle of expBlock.must_not_contain || []) {
    if (haystack.includes(needle.toLowerCase())) {
      failures.push(`${fieldName} must NOT contain "${needle}" but did`);
    }
  }
  return failures;
}

function checkEmailExpectation(result, expected) {
  const failures = [];
  if (expected.email_type) {
    const accepted = Array.isArray(expected.email_type) ? expected.email_type : [expected.email_type];
    if (!accepted.includes(result.email_type)) {
      failures.push(`email_type = "${result.email_type}", expected one of [${accepted.join(', ')}]`);
    }
  }
  failures.push(...checkBlock(result.shopping_items, expected.shopping_items, 'shopping_items'));
  failures.push(...checkBlock(result.events, expected.events, 'events'));
  failures.push(...checkBlock(result.tasks, expected.tasks, 'tasks'));

  // Inline-match assertions: each entry says "for the receipt item
  // containing X, the AI should set list_item_id = Y with confidence
  // >= Z." Used to test Tier 2.5's inline matching behaviour.
  for (const want of expected.inline_matches || []) {
    const r = want.receipt_contains?.toLowerCase() || '';
    const minConf = want.min_confidence ?? 0.7;
    const found = (result.shopping_items || []).find((it) =>
      JSON.stringify(it).toLowerCase().includes(r) &&
      it.list_item_id === want.expected_list_item_id &&
      (it.match_confidence ?? 0) >= minConf
    );
    if (!found) {
      failures.push(`Expected inline match (item~"${want.receipt_contains}" → list_item_id="${want.expected_list_item_id}", conf>=${minConf}) not found`);
    }
  }
  return failures;
}

function checkReceiptMatchExpectation(result, expected) {
  const failures = [];
  const matches = result.matches || [];

  // Each expected match: find a result row where receipt_item contains
  // receipt_contains and list_item_name contains list_item_contains
  // (case-insensitive), with confidence >= min_confidence.
  for (const want of expected.matches || []) {
    const r = want.receipt_contains?.toLowerCase();
    const l = want.list_item_contains?.toLowerCase();
    const minConf = want.min_confidence ?? 0.7;
    const found = matches.find((m) =>
      (!r || (m.receipt_item || '').toLowerCase().includes(r)) &&
      (!l || (m.list_item_name || '').toLowerCase().includes(l)) &&
      (m.confidence ?? 0) >= minConf
    );
    if (!found) {
      failures.push(`Expected match (receipt~"${want.receipt_contains}" → list~"${want.list_item_contains}", conf>=${minConf}) not found`);
    }
  }

  // For each receipt item that should NOT match: assert no match row
  // references it with confidence >= 0.6.
  for (const noMatchReceipt of expected.no_match_for || []) {
    const r = noMatchReceipt.toLowerCase();
    const accidental = matches.find((m) =>
      (m.receipt_item || '').toLowerCase().includes(r) &&
      (m.confidence ?? 0) >= 0.6
    );
    if (accidental) {
      failures.push(`Receipt item "${noMatchReceipt}" should NOT match anything, but matched "${accidental.list_item_name}" (conf=${accidental.confidence})`);
    }
  }

  return failures;
}

// ── Runner ──────────────────────────────────────────────────────────

async function runExtractionFixtures() {
  const fixtures = loadFixtures('extraction');
  let passed = 0, failed = 0;
  if (fixtures.length === 0) return { passed, failed };
  console.log('\nExtraction fixtures:');
  for (const f of fixtures) {
    process.stdout.write(`  ${f.name}: `);
    try {
      const result = await extractFromEmail(
        f.input.text || '',
        f.input.subject || '',
        f.input.members || [],
        f.input.context || {}
      );
      if (VERBOSE) console.log('\n    AI:', JSON.stringify(result, null, 2).replace(/\n/g, '\n    '));
      const failures = checkEmailExpectation(result, f.expected);
      if (failures.length === 0) {
        const summary = `email_type=${result.email_type}, items=${result.shopping_items?.length || 0}, events=${result.events?.length || 0}, tasks=${result.tasks?.length || 0}`;
        console.log(`\x1b[32m✓\x1b[0m ${VERBOSE ? '' : `(${summary})`}`);
        passed++;
      } else {
        console.log(`\x1b[31m✗\x1b[0m`);
        for (const msg of failures) console.log(`      - ${msg}`);
        failed++;
      }
    } catch (err) {
      console.log(`\x1b[31m✗\x1b[0m  (AI call failed: ${err.message})`);
      failed++;
    }
  }
  return { passed, failed };
}

async function runReceiptMatchFixtures() {
  const fixtures = loadFixtures('receipt-match');
  let passed = 0, failed = 0;
  if (fixtures.length === 0) return { passed, failed };
  console.log('\nReceipt-match fixtures:');
  for (const f of fixtures) {
    process.stdout.write(`  ${f.name}: `);
    try {
      const result = await matchReceiptToList(
        f.input.receiptItems || [],
        f.input.shoppingList || []
      );
      if (VERBOSE) console.log('\n    AI:', JSON.stringify(result, null, 2).replace(/\n/g, '\n    '));
      const failures = checkReceiptMatchExpectation(result, f.expected);
      if (failures.length === 0) {
        const matchCount = (result.matches || []).length;
        console.log(`\x1b[32m✓\x1b[0m ${VERBOSE ? '' : `(${matchCount} matches)`}`);
        passed++;
      } else {
        console.log(`\x1b[31m✗\x1b[0m`);
        for (const msg of failures) console.log(`      - ${msg}`);
        failed++;
      }
    } catch (err) {
      console.log(`\x1b[31m✗\x1b[0m  (AI call failed: ${err.message})`);
      failed++;
    }
  }
  return { passed, failed };
}

async function main() {
  console.log('Email AI eval suite');
  console.log('===================');
  if (ONLY) console.log(`Filter: --only=${ONLY}`);

  const start = Date.now();
  const a = await runExtractionFixtures();
  const b = await runReceiptMatchFixtures();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const totalPassed = a.passed + b.passed;
  const totalFailed = a.failed + b.failed;

  console.log(`\nSummary: ${totalPassed} passed, ${totalFailed} failed (${elapsed}s)`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Eval runner crashed:', err);
  process.exit(2);
});
