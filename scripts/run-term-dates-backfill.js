#!/usr/bin/env node
/**
 * Manual run of the term-dates backfill sweep (the same code the Monday
 * 04:30 UTC scheduler job runs). Fills schools whose family chose LA dates
 * but where the import never ran, from the school directory / LA directory /
 * LA scrape cache. Free reads only - never a live council scrape.
 *
 *   node scripts/run-term-dates-backfill.js
 */
require('dotenv').config();

const { backfillEmptyTermDates } = require('../src/services/term-dates-backfill');

(async () => {
  const result = await backfillEmptyTermDates();
  console.log(`\nConsidered: ${result.considered}`);
  for (const f of result.filled) {
    console.log(`  ✓ ${f.school}: ${f.count} dates from ${f.source}`);
  }
  for (const s of result.skipped) {
    console.log(`  – ${s.school}: still empty (${s.reason})`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
