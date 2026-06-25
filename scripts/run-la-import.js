#!/usr/bin/env node
/**
 * Run the LA term-dates import locally (no web server, no curl, no key).
 * Calls the importer service directly and streams progress to the terminal.
 *
 * Usage (from the repo root, so dotenv finds .env):
 *   node scripts/run-la-import.js            # all authorities (~15-30 min)
 *   node scripts/run-la-import.js barnet     # just one authority, by slug
 *   node scripts/run-la-import.js --pending  # only never-imported ones
 *   node scripts/run-la-import.js --stale    # never-imported or >25 days old
 *
 * Prerequisites: migration applied + `node scripts/seed-la-directory.js` run,
 * and AI keys present in .env (same ones the app uses).
 */
require('dotenv').config();
const { importAllAuthorities, importAuthority } = require('../src/services/laTermDatesImport');
const laDb = require('../src/db/laTermDates');

(async () => {
  const arg = process.argv[2];
  const t0 = Date.now();
  try {
    if (arg && !arg.startsWith('--')) {
      const la = await laDb.getAuthorityBySlug(arg);
      if (!la) {
        console.error(`No authority with slug "${arg}". Did you run the seed? Try a slug like "barnet".`);
        process.exit(1);
      }
      console.log(`Importing ${la.name}…`);
      const res = await importAuthority(la);
      console.log(`→ ${res.status}${res.error ? ': ' + res.error : ''}`);
    } else {
      const opts = { trigger: 'manual', onlyPending: arg === '--pending', onlyStale: arg === '--stale' };
      console.log(`Starting import (${arg || 'all authorities'})… a full run is ~183 councils and can take 15-30 min.`);
      const r = await importAllAuthorities(opts);
      console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s — ${r.succeeded} ok, ${r.partial} partial, ${r.failed} failed of ${r.total}.`);
      console.log('Anything in "failed"/"partial" is on the page\'s "Need attention" filter, each with its reason.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Import run failed:', err.message);
    process.exit(1);
  }
})();
