// One-off backfill: pre-populate every EXISTING household with the starter
// recipe set (src/lib/starterRecipes.js). New households get them automatically
// on creation (see POST /auth/create-household). Idempotent - re-running skips
// households that already have the starter recipes.
//
//   node scripts/seed-starter-recipes.js
require('dotenv').config();
const { supabaseAdmin: db } = require('../src/db/client');
const queries = require('../src/db/queries');

(async () => {
  const { data: households, error } = await db.from('households').select('id');
  if (error) { console.error('households lookup failed:', error.message); process.exit(1); }

  let seededHouseholds = 0, skipped = 0, rows = 0, failed = 0;
  for (const h of households) {
    try {
      const r = await queries.seedStarterRecipes(h.id, db);
      if (r.skipped) skipped++;
      else { seededHouseholds++; rows += r.seeded; }
    } catch (e) {
      failed++;
      console.error(`  household ${h.id} failed:`, e.message);
    }
  }

  console.log(`\nHouseholds: ${households.length}`);
  console.log(`  seeded:  ${seededHouseholds} (${rows} recipe rows)`);
  console.log(`  skipped: ${skipped} (already had starters)`);
  if (failed) console.log(`  failed:  ${failed}`);
})();
