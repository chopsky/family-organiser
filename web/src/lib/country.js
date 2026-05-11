/**
 * Country detection + display labels.
 *
 * Used to gate UK-only features (school directory, term-date imports,
 * year-group labels) for non-GB households. The household.country column
 * stores the canonical ISO 3166-1 alpha-2 code; this module is the
 * single source of truth for:
 *
 *   • What we recognise (the SUPPORTED_COUNTRIES list)
 *   • How we auto-detect at signup (detectCountryFromTimezone)
 *   • How we present in the UI (COUNTRY_LABELS)
 *
 * To add a new country: append to SUPPORTED_COUNTRIES + COUNTRY_LABELS,
 * append to the DB CHECK constraint (migration-household-country.sql),
 * and update src/routes/auth.js + src/routes/household.js allow-lists.
 */

export const SUPPORTED_COUNTRIES = ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'OTHER'];

export const COUNTRY_LABELS = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  OTHER: 'Other / not listed',
};

/**
 * Best-effort country code from the browser's timezone.
 *
 * Caveats:
 *   • Canadian users (America/Toronto, America/Vancouver, etc.) are
 *     classified as US because the timezone tree doesn't distinguish.
 *     They can correct in Settings.
 *   • Anyone outside the supported list lands in OTHER, which hides
 *     UK-only features (correct behaviour).
 */
export function detectCountryFromTimezone(tz) {
  if (!tz) return 'GB'; // default to the dominant tenant
  if (tz === 'Europe/London') return 'GB';
  if (tz === 'Europe/Dublin') return 'IE';
  if (tz.startsWith('America/')) return 'US';
  if (tz.startsWith('Australia/')) return 'AU';
  if (tz === 'Pacific/Auckland' || tz === 'Pacific/Chatham') return 'NZ';
  return 'OTHER';
}

/**
 * Convenience helper used in components to check whether a household
 * gets the full UK school experience.
 */
export function isUkHousehold(household) {
  return household?.country === 'GB';
}
