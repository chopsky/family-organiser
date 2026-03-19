#!/usr/bin/env node
/**
 * Import GOV.UK GIAS (Get Information About Schools) data into schools_directory table.
 *
 * Downloads the CSV from GOV.UK, parses it, and upserts ~25,000 open schools.
 *
 * Usage:
 *   node scripts/import-gias.js                    # Download and import
 *   node scripts/import-gias.js path/to/file.csv   # Import from local CSV
 *
 * The GIAS CSV can be downloaded manually from:
 *   https://get-information-schools.service.gov.uk/Downloads
 *   → "Establishment fields" → CSV
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Simple CSV parser (handles quoted fields)
function parseCSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
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

// Map GIAS school type codes to readable types
function mapSchoolType(typeGroup, typeOfEstablishment) {
  const type = (typeOfEstablishment || '').toLowerCase();
  if (type.includes('community')) return 'community';
  if (type.includes('voluntary aided')) return 'voluntary_aided';
  if (type.includes('voluntary controlled')) return 'voluntary_controlled';
  if (type.includes('foundation')) return 'foundation';
  if (type.includes('academy')) return 'academy';
  if (type.includes('free school')) return 'free_school';
  if (type.includes('independent')) return 'independent';
  return 'other';
}

function buildAddress(row) {
  const parts = [
    row['Street'],
    row['Locality'],
    row['Address3'],
    row['Town'],
    row['County (name)'],
  ].filter(Boolean);
  return parts.join(', ') || null;
}

async function importGIAS(csvPath) {
  console.log('Reading CSV...');
  const text = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(text);
  console.log(`Parsed ${rows.length} rows from CSV`);

  // Filter to open schools only
  const openSchools = rows.filter(r =>
    (r['EstablishmentStatus (name)'] || '').toLowerCase() === 'open'
  );
  console.log(`${openSchools.length} open schools`);

  // Map to our schema
  const schools = openSchools.map(r => ({
    urn: r['URN'],
    name: r['EstablishmentName'],
    type: mapSchoolType(r['EstablishmentTypeGroup (name)'], r['TypeOfEstablishment (name)']),
    phase: r['PhaseOfEducation (name)'] || null,
    local_authority: r['LA (name)'] || null,
    address: buildAddress(r),
    postcode: r['Postcode'] || null,
    status: 'open',
  })).filter(s => s.urn && s.name);

  console.log(`Importing ${schools.length} schools...`);

  // Batch upsert in chunks of 500
  const BATCH = 500;
  let imported = 0;
  for (let i = 0; i < schools.length; i += BATCH) {
    const batch = schools.slice(i, i + BATCH);
    const { error } = await supabase
      .from('schools_directory')
      .upsert(batch, { onConflict: 'urn' });

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message);
    } else {
      imported += batch.length;
      process.stdout.write(`\r  ${imported}/${schools.length} imported`);
    }
  }

  console.log(`\n✓ Import complete: ${imported} schools`);
}

async function downloadGIAS() {
  // The GIAS download page requires clicking through — provide instructions
  console.log('');
  console.log('GIAS CSV must be downloaded manually:');
  console.log('  1. Go to: https://get-information-schools.service.gov.uk/Downloads');
  console.log('  2. Select "Establishment fields" → Download as CSV');
  console.log('  3. Run: node scripts/import-gias.js path/to/downloaded.csv');
  console.log('');
  process.exit(1);
}

// Main
const csvArg = process.argv[2];
if (csvArg && fs.existsSync(csvArg)) {
  importGIAS(csvArg).catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
} else if (csvArg) {
  console.error(`File not found: ${csvArg}`);
  process.exit(1);
} else {
  downloadGIAS();
}
