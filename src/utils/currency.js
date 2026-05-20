/**
 * Country → currency mapping.
 *
 * Derives a household's default subscription currency from its country
 * code so the bot doesn't have to ask. The user can always override by
 * being explicit ("$9.99 a month") - see the classifier prompt.
 *
 * Returns { code, symbol } for the supported markets, or a generic
 * GBP fallback for OTHER. Codes are ISO 4217.
 */

const CURRENCY_BY_COUNTRY = {
  GB: { code: 'GBP', symbol: '£' },
  IE: { code: 'EUR', symbol: '€' },
  US: { code: 'USD', symbol: '$' },
  CA: { code: 'CAD', symbol: '$' },
  AU: { code: 'AUD', symbol: '$' },
  NZ: { code: 'NZD', symbol: '$' },
  ZA: { code: 'ZAR', symbol: 'R' },
};

function currencyForCountry(country) {
  if (!country) return CURRENCY_BY_COUNTRY.GB;
  return CURRENCY_BY_COUNTRY[country.toUpperCase()] || CURRENCY_BY_COUNTRY.GB;
}

const SYMBOL_TO_CODE = {
  '£': 'GBP',
  '€': 'EUR',
  '$': 'USD', // ambiguous (USD/CAD/AUD/NZD); caller can override
  'R': 'ZAR',
};

/** Best-effort parse of "£15.99" / "$9.99" / "15.99" into amount+currency. */
function parseMoneyString(text) {
  if (!text) return { amount: null, currency: null };
  const t = String(text).trim();
  const sym = Object.keys(SYMBOL_TO_CODE).find((s) => t.startsWith(s) || t.endsWith(s));
  const numeric = t.replace(/[^0-9.]/g, '');
  const amount = numeric ? Number(numeric) : null;
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: sym ? SYMBOL_TO_CODE[sym] : null,
  };
}

/** Format amount with symbol - for bot replies. £15.99, R199, $9.99. */
function formatMoney(amount, currencyCode) {
  if (amount == null) return '';
  const entry = Object.values(CURRENCY_BY_COUNTRY).find((c) => c.code === currencyCode);
  const symbol = entry?.symbol || '';
  // No decimals for whole-rand-style amounts; two decimals otherwise.
  const fixed = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
  return `${symbol}${fixed}`;
}

module.exports = { currencyForCountry, parseMoneyString, formatMoney };
