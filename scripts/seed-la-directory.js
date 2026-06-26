#!/usr/bin/env node
/**
 * Seed the la_directory table from the GOV.UK GIAS (Get Information About
 * Schools) establishment CSV.
 *
 * GIAS is the authoritative list of who actually maintains schools. We take
 * every distinct "LA (name)" among OPEN schools - those are the UK local
 * EDUCATION authorities that publish term dates (England + Wales). Crucially,
 * the names come straight from GIAS, so they match what Housemait already
 * stores in household_schools.local_authority - the directory can be looked up
 * by that value with no mapping layer.
 *
 * We intentionally drop non-LA buckets that GIAS lumps into the same column
 * ("Does not apply" = independent schools that set their own dates; "BFPO
 * Overseas Establishments" = forces schools abroad).
 *
 * Usage:
 *   node scripts/seed-la-directory.js                    # uses the repo's bundled CSV
 *   node scripts/seed-la-directory.js path/to/file.csv   # use a specific CSV
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in the environment (.env).
 * Run the migration (supabase/migration-la-term-dates-directory.sql) first.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Default to the GIAS CSV bundled in the repo root (yyyymmdd in the filename).
const DEFAULT_CSV = (() => {
  const root = path.join(__dirname, '..');
  const match = fs.readdirSync(root).find((f) => /^edubasealldata\d+\.csv$/i.test(f));
  return match ? path.join(root, match) : null;
})();

// Welsh principal areas as GIAS spells them (incl. a couple of known spelling
// variants). Everything else in the GIAS open-schools set is an English LA.
const WELSH_LAS = new Set([
  'blaenau gwent', 'bridgend', 'caerphilly', 'cardiff', 'carmarthenshire', 'ceredigion',
  'conwy', 'denbighshire', 'flintshire', 'gwynedd', 'isle of anglesey', 'merthyr tydfil',
  'monmouthshire', 'neath port talbot', 'newport', 'pembrokeshire', 'powys',
  'rhondda cynon taf', 'rhondda cynon taff', 'swansea', 'torfaen',
  'vale of glamorgan', 'the vale of glamorgan', 'wrexham',
]);

// Buckets in the "LA (name)" column that are NOT term-date-publishing LAs.
function isNonLA(name) {
  return /^does not apply$/i.test(name) || /bfpo|overseas|offshore/i.test(name);
}

// Real LAs we intentionally keep OUT of the directory: tiny/atypical authorities
// that don't publish a council-wide school calendar (their schools set their own
// dates), so an import only ever yields a "no dates" failure. City of London (a
// ~9-school LEA, almost all independent schools) is the clear case. Distinct from
// the non-authority junk in isNonLA. To un-hide one, remove it here and re-seed.
const HIDDEN_LAS = new Set(['city of london']);
function isHiddenLA(name) {
  return HIDDEN_LAS.has(name.toLowerCase().trim());
}

function regionFor(name) {
  return WELSH_LAS.has(name.toLowerCase().trim()) ? 'Wales' : 'England';
}

function slugFor(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Minimal CSV parsing (quoted fields, escaped quotes) - same approach as
// scripts/import-gias.js.
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function buildDirectory(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const laIdx = headers.indexOf('LA (name)');
  const statusIdx = headers.indexOf('EstablishmentStatus (name)');
  if (laIdx === -1 || statusIdx === -1) {
    throw new Error('CSV is missing "LA (name)" or "EstablishmentStatus (name)" columns - is this a GIAS establishment export?');
  }

  const counts = new Map();   // la name -> open school count
  const skipped = new Set();
  const hidden = new Set();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    if ((values[statusIdx] || '').trim().toLowerCase() !== 'open') continue;
    const la = (values[laIdx] || '').trim();
    if (!la) continue;
    if (isNonLA(la)) { skipped.add(la); continue; }
    if (isHiddenLA(la)) { hidden.add(la); continue; }
    counts.set(la, (counts.get(la) || 0) + 1);
  }

  const rows = [...counts.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({
    name,
    slug: slugFor(name),
    region: regionFor(name),
    school_count: counts.get(name),
    import_status: 'pending',
  }));
  return { rows, skipped: [...skipped], hidden: [...hidden] };
}

async function seed(csvPath) {
  console.log(`Reading GIAS CSV: ${csvPath}`);
  const { rows, skipped, hidden } = buildDirectory(csvPath);
  console.log(`Found ${rows.length} local education authorities (excluded non-LA buckets: ${skipped.join(', ') || 'none'}${hidden.length ? `; hidden by choice: ${hidden.join(', ')}` : ''})`);
  const england = rows.filter((r) => r.region === 'England').length;
  const wales = rows.filter((r) => r.region === 'Wales').length;
  console.log(`  England: ${england}   Wales: ${wales}`);

  // Upsert on name so re-running refreshes school_count without wiping import
  // status. We deliberately omit import_status from the conflict update so an
  // already-imported LA keeps its 'ok'/'failed' state across re-seeds.
  const payload = rows.map(({ name, slug, region, school_count }) => ({ name, slug, region, school_count }));
  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < payload.length; i += BATCH) {
    const batch = payload.slice(i, i + BATCH);
    const { error } = await supabase.from('la_directory').upsert(batch, { onConflict: 'name', ignoreDuplicates: false });
    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message);
      process.exit(1);
    }
    upserted += batch.length;
    process.stdout.write(`\r  ${upserted}/${payload.length} authorities seeded`);
  }
  console.log(`\n✓ Seed complete: ${upserted} authorities in la_directory`);
}

const csvArg = process.argv[2];
const csvPath = csvArg || DEFAULT_CSV;
if (!csvPath) {
  console.error('No GIAS CSV found. Pass a path: node scripts/seed-la-directory.js path/to/edubasealldata.csv');
  console.error('Download from https://get-information-schools.service.gov.uk/Downloads ("Establishment fields" → CSV).');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}
seed(csvPath).catch((err) => { console.error('Seed failed:', err); process.exit(1); });
