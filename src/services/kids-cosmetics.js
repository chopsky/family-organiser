// Kids-mode cosmetic catalogue - the AUTHORITATIVE list of what a kid can buy
// with stars, used to validate purchases (cost + season + kind). This is the
// security boundary: the server never trusts a client-sent price. Visual data
// (theme colours, sticker emoji, display names) lives on the frontend
// (web/src/lib/kidsTheme.js + kidsCosmetics.js), keyed by the SAME keys.
//
// Decoupling: cosmetics are bought with STARS ONLY - a streak never grants one
// (see docs/kids-engagement-plan.md). Free themes/avatars stay free.

const COSMETICS = [
  // Premium themes. The key IS the kid_color theme key, so owning + selecting
  // one re-themes the whole Kids skin via kidTheme(). Keep in sync with the
  // `premium: true` presets in web/src/lib/kidsTheme.js.
  { key: 'galaxy', kind: 'theme', cost: 60 },
  { key: 'dino', kind: 'theme', cost: 60 },
  { key: 'unicorn', kind: 'theme', cost: 60 },
  { key: 'ocean', kind: 'theme', cost: 60 },
  // Collectible stickers (shown on the kid's profile). Keep in sync with
  // STICKER_VISUALS in web/src/lib/kidsCosmetics.js.
  { key: 'sticker_rainbow', kind: 'sticker', cost: 15 },
  { key: 'sticker_rocket', kind: 'sticker', cost: 20 },
  { key: 'sticker_crown', kind: 'sticker', cost: 25 },
  { key: 'sticker_trophy', kind: 'sticker', cost: 25 },
  { key: 'sticker_superstar', kind: 'sticker', cost: 20 },
  { key: 'sticker_pizza', kind: 'sticker', cost: 15 },
  // Seasonal drop: only buyable inside its window (year-agnostic 'MM-DD').
  { key: 'sticker_summer', kind: 'sticker', cost: 15, season: { from: '06-01', to: '08-31' } },
];

const byKey = Object.fromEntries(COSMETICS.map((c) => [c.key, c]));

function getCosmetic(key) {
  return byKey[key] || null;
}

// Is a cosmetic buyable on `todayMMDD` ('MM-DD')? Non-seasonal items are always
// in season. A window with from > to wraps the year end (e.g. Dec->Jan).
function inSeason(cosmetic, todayMMDD) {
  const s = cosmetic && cosmetic.season;
  if (!s) return true;
  const { from, to } = s;
  return from <= to ? (todayMMDD >= from && todayMMDD <= to) : (todayMMDD >= from || todayMMDD <= to);
}

// The catalogue for the shop, each entry stamped with `inSeason` for todayMMDD.
function getCatalogue(todayMMDD) {
  return COSMETICS.map((c) => ({ key: c.key, kind: c.kind, cost: c.cost, seasonal: !!c.season, inSeason: inSeason(c, todayMMDD) }));
}

module.exports = { COSMETICS, getCosmetic, inSeason, getCatalogue };
