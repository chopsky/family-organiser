/**
 * Public Holidays Service
 *
 * Uses the Nager.Date API (https://date.nager.at) to fetch public/bank holidays
 * and inserts them as calendar events when a household is created.
 *
 * Holidays are also refreshed yearly via a cron job (Dec 1) to add next year's holidays.
 */

const axios = require('axios');
const db = require('../db/queries');

const NAGER_API = 'https://date.nager.at/api/v3';

// Map common timezones to ISO 3166-1 alpha-2 country codes
const TIMEZONE_TO_COUNTRY = {
  // Africa
  'Africa/Johannesburg': 'ZA',
  'Africa/Cairo': 'EG',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  // Europe
  'Europe/London': 'GB',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/Vienna': 'AT',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Dublin': 'IE',
  'Europe/Lisbon': 'PT',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Athens': 'GR',
  'Europe/Istanbul': 'TR',
  // Americas
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Argentina/Buenos_Aires': 'AR',
  // Asia-Pacific
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Singapore': 'SG',
  'Asia/Seoul': 'KR',
  'Asia/Kolkata': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Jerusalem': 'IL',
  // Oceania
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ',
};

/**
 * Derive country code from a timezone string.
 */
function countryFromTimezone(tz) {
  if (!tz) return null;
  // Direct lookup
  if (TIMEZONE_TO_COUNTRY[tz]) return TIMEZONE_TO_COUNTRY[tz];
  // Fuzzy: match by region prefix (e.g. "America/Indiana/Indianapolis" → try "America/")
  const parts = tz.split('/');
  if (parts.length >= 2) {
    for (const [key, val] of Object.entries(TIMEZONE_TO_COUNTRY)) {
      if (key.startsWith(parts[0] + '/' + parts[1])) return val;
    }
  }
  return null;
}

/**
 * Fetch public holidays from Nager.Date API for a given country and year.
 */
async function fetchHolidays(countryCode, year) {
  try {
    const { data } = await axios.get(`${NAGER_API}/PublicHolidays/${year}/${countryCode}`, {
      timeout: 10000,
    });
    return data; // Array of { date, localName, name, countryCode, ... }
  } catch (err) {
    console.error(`Failed to fetch holidays for ${countryCode}/${year}:`, err.message);
    return [];
  }
}

/**
 * Insert public holidays as calendar events for a household.
 * Skips any holidays that already exist (by title + date) to avoid duplicates.
 */
async function insertHolidaysForHousehold(householdId, countryCode, year, createdByUserId) {
  const holidays = await fetchHolidays(countryCode, year);
  if (!holidays.length) return 0;

  let inserted = 0;
  for (const h of holidays) {
    // Use the local name if available, fall back to English name
    const title = h.localName || h.name;
    const startTime = `${h.date}T00:00:00`;
    const endTime = `${h.date}T23:59:59`;

    try {
      // Dedupe by (title, date) only - don't constrain to category =
      // 'public_holiday' because legacy rows seeded before that column
      // existed have category=NULL, and an over-narrow filter caused
      // every subsequent seed/refresh run to re-insert them as fresh
      // duplicates. all_day=true narrows enough to avoid clobbering
      // user-created timed events that happen to share a name with a
      // holiday (e.g. "Boxing Day breakfast").
      const { data: existing } = await db.getSupabase()
        .from('calendar_events')
        .select('id')
        .eq('household_id', householdId)
        .eq('title', title)
        .eq('all_day', true)
        .gte('start_time', `${h.date}T00:00:00`)
        .lte('start_time', `${h.date}T23:59:59`)
        .limit(1);

      if (existing && existing.length > 0) continue; // Already exists

      await db.getSupabase()
        .from('calendar_events')
        .insert({
          household_id: householdId,
          title,
          description: h.name !== h.localName ? h.name : null,
          start_time: startTime,
          end_time: endTime,
          all_day: true,
          color: 'red',
          category: 'public_holiday',
          visibility: 'family',
          created_by: createdByUserId,
        });
      inserted++;
    } catch (err) {
      console.error(`Failed to insert holiday "${title}":`, err.message);
    }
  }

  console.log(`Inserted ${inserted} public holidays for household ${householdId} (${countryCode} ${year})`);
  return inserted;
}

/**
 * Resolve a household's effective country code for holiday lookup.
 *
 * Prefers the explicit households.country column (set on creation via
 * detectCountryFromTimezone + can be corrected via support / SQL), and
 * falls back to deriving from timezone if country isn't set (e.g. for
 * legacy rows from before the country column existed).
 *
 * Returns null if neither yields a country we can use, in which case the
 * caller should skip holiday seeding for that household.
 */
function resolveCountryCode(household) {
  if (household?.country === 'OTHER') {
    // OTHER is the system saying "I don't know where this family lives".
    // Never answer that with the timezone - it reflects wherever the
    // phone was standing at signup, and guessing seeded 64 Spanish bank
    // holidays onto a UK family's calendar (2026-08-10). No holidays is
    // a shrug; the wrong country's is a support email.
    return null;
  }
  if (household?.country) return household.country;
  // Legacy rows from before the country column existed carry null -
  // timezone is the only signal they ever had, so keep using it for them.
  return countryFromTimezone(household?.timezone);
}

/**
 * Called when a household is created. Inserts current + next year holidays.
 */
async function seedHolidaysForNewHousehold(householdId, timezone, createdByUserId, country) {
  // Seed strictly from the KNOWN country. OTHER (or absent) means the
  // signup cascade couldn't tell where this family lives - never fall
  // back to timezone here, it's a location signal not a home signal
  // (the Maxine mis-country: Europe/Madrid seeded Spanish holidays for
  // a UK household, 2026-08-10). They get holidays the moment they set
  // their country in Settings (replace re-seed) instead.
  const countryCode = country && country !== 'OTHER' ? country : null;
  if (!countryCode) {
    console.log(`Country "${country}" (tz "${timezone}") - skipping holiday seed rather than guessing`);
    return;
  }

  const currentYear = new Date().getFullYear();
  // Insert this year and next year
  await insertHolidaysForHousehold(householdId, countryCode, currentYear, createdByUserId);
  await insertHolidaysForHousehold(householdId, countryCode, currentYear + 1, createdByUserId);
}

/**
 * Yearly refresh: fetch current + next year's holidays for all households.
 * Called by cron job in December.
 *
 * Current year is included as self-healing: if a December run is ever missed
 * (server down, Nager outage), that year would otherwise be permanently
 * skipped - the cron only looks forward and nothing retries. Re-inserting the
 * current year is a no-op on the happy path because insertHolidaysForHousehold
 * dedupes against existing all-day events before inserting.
 */
async function refreshHolidaysForAllHouseholds() {
  const households = await db.getAllHouseholds();
  const currentYear = new Date().getFullYear();

  for (const household of households) {
    const countryCode = resolveCountryCode(household);
    if (!countryCode) continue;
    await insertHolidaysForHousehold(household.id, countryCode, currentYear, null);
    await insertHolidaysForHousehold(household.id, countryCode, currentYear + 1, null);
  }
}

/**
 * REPLACE re-seed for a country change: wipe the seeder-owned
 * public_holiday events, then insert the new country's set (current +
 * next year). Runs when a household corrects its country in Settings -
 * the by-hand fix from the Maxine mis-country becomes one tap. OTHER
 * wipes and seeds nothing (never guess).
 */
async function replaceHolidaysForHousehold(householdId, country, createdByUserId) {
  const { removed } = await db.deletePublicHolidayEvents(householdId);
  if (!country || country === 'OTHER') {
    console.log(`Replaced holidays for ${householdId}: removed ${removed}, seeded 0 (country ${country})`);
    return { removed, inserted: 0 };
  }
  const year = new Date().getFullYear();
  const a = await insertHolidaysForHousehold(householdId, country, year, createdByUserId);
  const b = await insertHolidaysForHousehold(householdId, country, year + 1, createdByUserId);
  console.log(`Replaced holidays for ${householdId}: removed ${removed}, seeded ${a + b} (${country})`);
  return { removed, inserted: a + b };
}

module.exports = {
  countryFromTimezone,
  resolveCountryCode,
  fetchHolidays,
  insertHolidaysForHousehold,
  seedHolidaysForNewHousehold,
  refreshHolidaysForAllHouseholds,
  replaceHolidaysForHousehold,
};
