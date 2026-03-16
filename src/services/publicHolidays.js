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
      const { data: existing } = await db.getSupabase()
        .from('calendar_events')
        .select('id')
        .eq('household_id', householdId)
        .eq('category', 'public_holiday')
        .eq('title', title)
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
 * Called when a household is created. Inserts current + next year holidays.
 */
async function seedHolidaysForNewHousehold(householdId, timezone, createdByUserId) {
  const countryCode = countryFromTimezone(timezone);
  if (!countryCode) {
    console.log(`No country mapping for timezone "${timezone}" — skipping holiday seed`);
    return;
  }

  const currentYear = new Date().getFullYear();
  // Insert this year and next year
  await insertHolidaysForHousehold(householdId, countryCode, currentYear, createdByUserId);
  await insertHolidaysForHousehold(householdId, countryCode, currentYear + 1, createdByUserId);
}

/**
 * Yearly refresh: fetch next year's holidays for all households.
 * Called by cron job in December.
 */
async function refreshHolidaysForAllHouseholds() {
  const households = await db.getAllHouseholds();
  const nextYear = new Date().getFullYear() + 1;

  for (const household of households) {
    const countryCode = countryFromTimezone(household.timezone);
    if (!countryCode) continue;
    await insertHolidaysForHousehold(household.id, countryCode, nextYear, null);
  }
}

module.exports = {
  countryFromTimezone,
  fetchHolidays,
  insertHolidaysForHousehold,
  seedHolidaysForNewHousehold,
  refreshHolidaysForAllHouseholds,
};
