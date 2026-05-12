/**
 * Locale configuration — single source of truth for region-specific marketing.
 *
 * Every locale entry maps to:
 *   • a unique URL path (/gb, /us, …) used by both routing and hreflang.
 *     We use ISO 3166-1 alpha-2 country codes (gb, us, eu, au, ca, za)
 *     because that's exactly what Vercel returns in x-vercel-ip-country,
 *     so the middleware's path-for-country mapping stays trivial
 *   • a Stripe currency code (GBP, USD, …) — combined with the billing
 *     interval, this resolves to a Stripe Price via lookup_key, e.g.
 *     `monthly_gbp`, `annual_usd`. The matching Price objects live in
 *     Stripe — DON'T duplicate the underlying prices here, only their
 *     human-readable display values
 *   • feature flags so we can hide UK-only surfaces (school term dates)
 *     on other markets without forking the page
 *
 * Two non-obvious bits:
 *
 *   1. The `default` locale lives at `/` and is the hreflang x-default.
 *      Visitors from any country we don't have a dedicated page for land
 *      here. USD pricing is used because that's the broadest fit for the
 *      "rest of world" English-speaking market.
 *
 *   2. The `/eu` page targets European English speakers and is declared
 *      via hreflang as `en-IE` (Ireland is the most populous EU country
 *      with English as an official language post-Brexit). Search Console
 *      can be told to also surface `/eu` for other EU country codes via
 *      the additionalHreflang field — see SEO Tier 2 work.
 */

export const LOCALES = {
  gb: {
    code: 'gb',
    path: '/gb',
    hreflang: 'en-GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    currencySymbol: '£',
    stripeCurrency: 'gbp', // matches lookup_key suffix
    pricing: {
      monthly: '£5.99',
      annual: '£59.99',
      monthlyEquivalent: '£5',
      savings: 'Save £11.89 · 2 months free',
      compareReference: 'a takeaway',
    },
    features: { schoolTerms: true, whatsappBot: true },
    audienceTagline: 'modern UK families',
    footerNote: 'Made with ❤️ for UK families',
    demo: {
      dentistLocation: 'Bellingham Dental, Bristol',
      milkSize: '2L',
      chickenSize: '1kg',
    },
  },
  us: {
    code: 'us',
    path: '/us',
    hreflang: 'en-US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    currencySymbol: '$',
    stripeCurrency: 'usd',
    pricing: {
      monthly: '$7.99',
      annual: '$79.99',
      monthlyEquivalent: '$6.67',
      savings: 'Save $15.89 · 2 months free',
      compareReference: 'a takeout meal',
    },
    features: { schoolTerms: false, whatsappBot: true },
    audienceTagline: 'modern families',
    footerNote: 'Made with ❤️ for modern families',
    demo: {
      dentistLocation: 'Cedar Park Family Dental, Austin',
      milkSize: '1 gallon',
      chickenSize: '2 lb',
    },
  },
  eu: {
    code: 'eu',
    path: '/eu',
    hreflang: 'en-IE', // representative — see file header
    name: 'Europe',
    flag: '🇪🇺',
    currency: 'EUR',
    currencySymbol: '€',
    stripeCurrency: 'eur',
    pricing: {
      monthly: '€6.99',
      annual: '€69.99',
      monthlyEquivalent: '€5.83',
      savings: 'Save €13.89 · 2 months free',
      compareReference: 'a takeaway',
    },
    features: { schoolTerms: false, whatsappBot: true },
    audienceTagline: 'modern European families',
    footerNote: 'Made with ❤️ for modern families',
    demo: {
      // Deliberately non-specific — the /eu page serves visitors from
      // 27+ countries, no single city would feel local to all of them.
      dentistLocation: 'Happy Smiles Dental',
      milkSize: '2L',
      chickenSize: '1kg',
    },
  },
  au: {
    code: 'au',
    path: '/au',
    hreflang: 'en-AU',
    name: 'Australia',
    flag: '🇦🇺',
    currency: 'AUD',
    currencySymbol: 'A$',
    stripeCurrency: 'aud',
    pricing: {
      monthly: 'A$9.99',
      annual: 'A$99.99',
      monthlyEquivalent: 'A$8.33',
      savings: 'Save A$19.89 · 2 months free',
      compareReference: 'a takeaway',
    },
    features: { schoolTerms: false, whatsappBot: true },
    audienceTagline: 'modern Australian families',
    footerNote: 'Made with ❤️ for Australian families',
    demo: {
      dentistLocation: 'Newtown Family Dental, Sydney',
      milkSize: '2L',
      chickenSize: '1kg',
    },
  },
  ca: {
    code: 'ca',
    path: '/ca',
    hreflang: 'en-CA',
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    currencySymbol: 'C$',
    stripeCurrency: 'cad',
    pricing: {
      monthly: 'C$9.99',
      annual: 'C$99.99',
      monthlyEquivalent: 'C$8.33',
      savings: 'Save C$19.89 · 2 months free',
      compareReference: 'takeout',
    },
    features: { schoolTerms: false, whatsappBot: true },
    audienceTagline: 'modern Canadian families',
    footerNote: 'Made with ❤️ for Canadian families',
    demo: {
      dentistLocation: 'Beaches Family Dental, Toronto',
      milkSize: '2L',
      chickenSize: '1kg',
    },
  },
  za: {
    code: 'za',
    path: '/za',
    hreflang: 'en-ZA',
    name: 'South Africa',
    flag: '🇿🇦',
    currency: 'ZAR',
    currencySymbol: 'R',
    stripeCurrency: 'zar',
    pricing: {
      monthly: 'R99',
      annual: 'R999',
      monthlyEquivalent: 'R83',
      savings: 'Save R189 · 2 months free',
      compareReference: 'a takeaway',
    },
    features: { schoolTerms: false, whatsappBot: true },
    audienceTagline: 'modern South African families',
    footerNote: 'Made with ❤️ for South African families',
    demo: {
      dentistLocation: 'Sandton Family Dental, Johannesburg',
      milkSize: '2L',
      chickenSize: '1kg',
    },
  },
  default: {
    code: 'default',
    path: '/',
    hreflang: 'x-default',
    name: 'International',
    flag: '🌐',
    currency: 'USD',
    currencySymbol: '$',
    stripeCurrency: 'usd',
    pricing: {
      monthly: '$7.99',
      annual: '$79.99',
      monthlyEquivalent: '$6.67',
      savings: 'Save $15.89 · 2 months free',
      compareReference: 'a takeout meal',
    },
    features: { schoolTerms: false, whatsappBot: true },
    audienceTagline: 'modern families',
    footerNote: 'Made with ❤️ for modern families',
    demo: {
      // Match the EU page's neutral framing — no city, no national
      // associations for the rest-of-world fallback audience.
      dentistLocation: 'Happy Smiles Dental',
      milkSize: '2L',
      chickenSize: '1kg',
    },
  },
};

/** Canonical site origin — used to build absolute URLs in hreflang and canonical tags. */
export const SITE_URL = 'https://housemait.com';

/** Cookie that records the locale a visitor last engaged with. Read by
 *  the checkout flow so we charge the right currency. */
export const LOCALE_COOKIE = 'housemait-locale';

/** Stable iteration order — matters for sitemap generation and hreflang
 *  rendering so the alt tags appear in a consistent sequence. */
export const LOCALE_ORDER = ['gb', 'us', 'eu', 'au', 'ca', 'za'];

/** Resolve a locale config from a URL pathname. Anything that doesn't
 *  match a known prefix falls back to `default`. The lookup is prefix-
 *  based so deep links like `/gb/anything` still resolve to the UK
 *  locale — useful if we ever add localised sub-pages. */
export function getLocaleByPath(pathname) {
  for (const code of LOCALE_ORDER) {
    const locale = LOCALES[code];
    if (pathname === locale.path || pathname.startsWith(`${locale.path}/`)) {
      return locale;
    }
  }
  return LOCALES.default;
}

/** All locales as an array, including default — used by sitemap + hreflang. */
export function allLocales() {
  return [...LOCALE_ORDER.map((c) => LOCALES[c]), LOCALES.default];
}

/**
 * Map a household.country code (ISO 3166-1 alpha-2 — 'GB', 'ZA' etc.)
 * back to a marketing locale config.
 *
 * Used by Subscribe.jsx so that a signed-in user's PRICING is driven by
 * the country they signed up under (household.country, set canonically
 * at signup) rather than the locale cookie, which gets overwritten
 * every time they visit a marketing page. Stops scenarios like: 'I
 * signed up via /za with ZAR pricing, but logging back in via my UK IP
 * now shows me GBP'.
 *
 * Returns null when there's no exact locale match — caller falls back
 * to the cookie or the default locale. Cases where this returns null:
 *   • country='OTHER' — visitor outside our supported markets
 *   • country='NZ'   — no dedicated /nz marketing page (yet)
 *   • country='IE'   — collapsed under /eu since both use EUR
 */
const COUNTRY_TO_LOCALE = {
  GB: 'gb',
  US: 'us',
  AU: 'au',
  CA: 'ca',
  ZA: 'za',
  IE: 'eu',
};
export function getLocaleByCountry(country) {
  if (!country) return null;
  const code = COUNTRY_TO_LOCALE[country.toUpperCase()];
  return code && LOCALES[code] ? LOCALES[code] : null;
}
