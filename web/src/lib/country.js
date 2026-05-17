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

export const SUPPORTED_COUNTRIES = ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'ZA', 'OTHER'];

export const COUNTRY_LABELS = {
  GB: 'United Kingdom',
  IE: 'Ireland',
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  ZA: 'South Africa',
  OTHER: 'Other / not listed',
};

/**
 * Per-country WhatsApp phone-number placeholder. Used in Settings →
 * Connect WhatsApp and the onboarding ConnectWhatsApp step so users
 * see a hint that matches their dialling code (a UK user sees +44…,
 * a SA user sees +27…, etc.) rather than a one-size-fits-all GB
 * example. UK uses the Ofcom-reserved 07700 9xxxxx range that's
 * specifically allocated for examples; other countries use a
 * non-allocated-but-plausible-looking format.
 */
const WHATSAPP_PHONE_PLACEHOLDERS = {
  GB: '+44 7700 900000',
  IE: '+353 85 123 4567',
  US: '+1 555 123 4567',
  CA: '+1 555 123 4567',
  AU: '+61 412 345 678',
  NZ: '+64 21 123 4567',
  ZA: '+27 71 234 5678',
};

export function getWhatsAppPlaceholder(countryCode) {
  if (!countryCode) return '+44 7700 900000';
  return WHATSAPP_PHONE_PLACEHOLDERS[countryCode.toUpperCase()] || '+44 7700 900000';
}

/**
 * Country code from the marketing locale cookie set by useLocale (see
 * web/src/hooks/useLocale.js).
 *
 * The locale cookie is set when a visitor lands on one of the
 * country-specific marketing pages (/gb, /us, /za, etc.), driven by
 * Vercel's edge geo-routing. Using this as the primary signal — over
 * browser timezone — fixes two real cases:
 *
 *   • Canadians (timezone = America/Toronto) who would otherwise be
 *     classified as US by timezone alone, now correctly land as CA.
 *   • SA expats abroad whose timezone is wrong, but who came in via
 *     the /za page deliberately.
 *
 * Returns null for the 'eu' (covers multiple countries) and 'default'
 * (unknown) locales — caller should fall back to timezone detection
 * in those cases.
 */
export function detectCountryFromLocaleCookie(localeCode) {
  if (!localeCode) return null;
  const map = { gb: 'GB', us: 'US', au: 'AU', za: 'ZA', ca: 'CA' };
  return map[localeCode.toLowerCase()] || null;
}

/**
 * Best-effort country code from the browser's timezone. Used as a
 * fallback when no locale cookie is set (visitor signing up directly
 * via /signup without touching a marketing page first, or visiting
 * the /eu page which covers multiple countries).
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
  // South Africa uses a single timezone (SAST, UTC+2). 'Africa/Johannesburg'
  // is the canonical IANA name; older systems also use 'Africa/Maseru'
  // (Lesotho) and 'Africa/Mbabane' (Eswatini) which share the same offset
  // and are typically reported as Africa/Johannesburg by modern browsers.
  if (tz === 'Africa/Johannesburg') return 'ZA';
  return 'OTHER';
}

/**
 * Convenience helper used in components to check whether a household
 * gets the full UK school experience.
 */
export function isUkHousehold(household) {
  return household?.country === 'GB';
}

/**
 * Whether a household has access to ANY schools UI (UK-style GIAS search
 * or SA-style manual entry + national term-date import). For other
 * countries the schools section is hidden entirely with a Coming-soon
 * placeholder.
 */
export function hasSchoolsFeature(household) {
  return household?.country === 'GB' || household?.country === 'ZA';
}

/**
 * Whether a household uses the SA flow (manual school name, no GIAS,
 * national term-date import option). UK households still use the GIAS-
 * driven directory + LA-dates flow.
 */
export function isSouthAfricaHousehold(household) {
  return household?.country === 'ZA';
}
