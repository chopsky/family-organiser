#!/usr/bin/env node
/**
 * Backfill the 'birthday' category onto birthday events that were created
 * BEFORE auto-categorisation shipped.
 *
 * Only events whose title reads like an actual birthday (per the shared
 * isBirthdayTitle helper - which already excludes parties, "buy gift", etc.)
 * AND whose current category is generic (null / 'general' / 'event') are
 * touched. Recurrence is NOT changed - repeating yearly stays opt-in.
 *
 * Safe by default: DRY RUN (prints what it would change). Pass --apply to write.
 *
 *   node scripts/backfill-birthday-category.js          # dry run
 *   node scripts/backfill-birthday-category.js --apply  # actually update
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env (prod).
 */
require('dotenv').config();
const { supabaseAdmin: db } = require('../src/db/client');
const { isBirthdayTitle } = require('../src/db/queries');

const APPLY = process.argv.includes('--apply');
const GENERIC = new Set([null, undefined, '', 'general', 'event']);
const PAGE = 1000;

async function run() {
  console.log(`🎂 Birthday category backfill - ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  // Coarse SQL prefilter on the title to keep the scan small; the precise
  // decision is made in JS by isBirthdayTitle.
  const titleFilter = 'title.ilike.%birthday%,title.ilike.%bday%,title.ilike.%b-day%,title.ilike.%🎂%';

  const toUpdate = [];
  let scanned = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('calendar_events')
      .select('id, title, category, household_id')
      .or(titleFilter)
      .is('deleted_at', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    scanned += data.length;
    for (const ev of data) {
      if (ev.category === 'birthday') continue;          // already done
      if (!GENERIC.has(ev.category)) continue;            // don't override a real category
      if (!isBirthdayTitle(ev.title)) continue;           // excludes parties / errands
      toUpdate.push(ev);
    }
    if (data.length < PAGE) break;
  }

  console.log(`Scanned ${scanned} candidate events; ${toUpdate.length} will become category='birthday'.`);
  for (const ev of toUpdate.slice(0, 20)) {
    console.log(`  • "${ev.title}"  (was ${ev.category ?? 'null'})`);
  }
  if (toUpdate.length > 20) console.log(`  …and ${toUpdate.length - 20} more`);

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.');
    return;
  }

  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += 200) {
    const chunk = toUpdate.slice(i, i + 200).map((e) => e.id);
    const { error } = await db.from('calendar_events').update({ category: 'birthday' }).in('id', chunk);
    if (error) { console.warn(`  chunk update failed: ${error.message}`); continue; }
    updated += chunk.length;
    console.log(`  updated ${updated}/${toUpdate.length}`);
  }
  console.log(`\n✓ Done. ${updated} events re-categorised as birthdays.`);
}

run().catch((err) => { console.error('❌ Backfill failed:', err.message); process.exit(1); });
