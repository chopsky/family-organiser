#!/usr/bin/env node
/**
 * Rescue one-off chores that were stored without a due date.
 *
 * The create form offered "One-time" but never sent a `due_date`, so these were
 * saved with `due_date: null`. appliesOn compares `due_date === dateStr`, which
 * is false for every date, so the task existed, appeared in the week view
 * (which lists all definitions unfiltered) and never showed on a single day.
 * Reported by a user on 2026-07-27; every one-off ever created was affected.
 *
 * The code fix stops new ones being created. This repairs the existing rows by
 * giving each the date it was created on, in the household's own timezone —
 * the day the user was looking at when they added it, which is where they
 * expected to see it.
 *
 * Rows created before today land in the past, so they will show on that past
 * day rather than today. That is deliberate: inventing a present-day date would
 * silently rewrite what the user asked for. Anything still wanted can be
 * re-dated in the app now that the field exists.
 *
 * Safe by default: DRY RUN. Pass --apply to write.
 *
 *   node scripts/fix-dateless-oneoffs.js          # dry run
 *   node scripts/fix-dateless-oneoffs.js --apply  # repair
 */
require('dotenv').config();
const { supabaseAdmin: db } = require('../src/db/client');

const APPLY = process.argv.includes('--apply');

async function main() {
  const { data: defs, error } = await db
    .from('chore_definitions')
    .select('id, household_id, title, repeat, due_date, archived_at, created_at')
    .eq('repeat', 'once')
    .is('due_date', null);
  if (error) throw error;

  const live = (defs || []).filter((d) => !d.archived_at);
  if (live.length === 0) { console.log('Nothing to fix.'); return; }

  // One timezone lookup per household, not per row.
  const tzByHousehold = new Map();
  for (const hh of new Set(live.map((d) => d.household_id))) {
    let tz = 'Europe/London';
    try {
      const { data } = await db.from('households').select('timezone').eq('id', hh).single();
      tz = data?.timezone || tz;
    } catch { /* default */ }
    tzByHousehold.set(hh, tz);
  }

  let fixed = 0;
  const failures = [];
  for (const d of live) {
    const tz = tzByHousehold.get(d.household_id);
    const date = new Date(d.created_at).toLocaleDateString('en-CA', { timeZone: tz });
    console.log(`  ${APPLY ? 'fixing' : 'would fix'}  ${String(d.title).slice(0, 34).padEnd(35)} -> ${date}`);
    if (!APPLY) { fixed += 1; continue; }
    const { error: upErr } = await db
      .from('chore_definitions')
      .update({ due_date: date })
      .eq('id', d.id);
    if (upErr) failures.push({ id: d.id, error: upErr.message });
    else fixed += 1;
  }

  console.log(`\n${APPLY ? 'Repaired' : 'Would repair'}  ${fixed} of ${live.length}`);
  if (failures.length) {
    console.log(`✗ ${failures.length} failed:`);
    for (const f of failures) console.log(`  ${f.id}: ${f.error}`);
    process.exitCode = 1;
  }
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
