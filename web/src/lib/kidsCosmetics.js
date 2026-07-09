// Kids-mode cosmetics - the VISUAL side of the star-shop (Phase 2). Cost, kind
// and season are authoritative on the server (src/services/kids-cosmetics.js)
// and arrive via GET /api/kids/cosmetics; this file supplies how each cosmetic
// LOOKS, keyed by the same key. Premium theme colours come from kidsTheme.js
// (so kidTheme() can render an owned+selected theme); stickers are here.
//
// Decoupling: cosmetics are bought with STARS ONLY - a streak never grants one.
import { KID_COLOR_PRESETS } from './kidsTheme';

// Collectible stickers shown on the kid's profile. Keys mirror the server.
export const STICKER_VISUALS = {
  sticker_rainbow: { emoji: '🌈', name: 'Rainbow' },
  sticker_rocket: { emoji: '🚀', name: 'Rocket' },
  sticker_crown: { emoji: '👑', name: 'Crown' },
  sticker_trophy: { emoji: '🏆', name: 'Trophy' },
  sticker_superstar: { emoji: '🤩', name: 'Superstar' },
  sticker_pizza: { emoji: '🍕', name: 'Pizza' },
  sticker_summer: { emoji: '☀️', name: 'Summer Sun' },
};

// Premium themes, keyed for quick lookup (colours + display name).
export const premiumThemeByKey = Object.fromEntries(
  KID_COLOR_PRESETS.filter((p) => p.premium).map((p) => [p.key, p]),
);

/**
 * Join the server catalogue (cost / kind / inSeason) with local visuals into
 * shop-ready items. Out-of-season items are hidden unless the kid already owns
 * one; items with no matching visual are dropped (defensive).
 *
 * @param catalogue [{ key, kind, cost, seasonal, inSeason }]
 * @param owned     string[] of owned cosmetic keys
 * @returns [{ key, kind, cost, seasonal, owned, affordable(bal), name, emoji?, theme? }]
 */
export function shopItems(catalogue, owned, balance) {
  const ownedSet = new Set(owned || []);
  return (catalogue || [])
    .filter((c) => c.inSeason || ownedSet.has(c.key))
    .map((c) => {
      const theme = c.kind === 'theme' ? premiumThemeByKey[c.key] : null;
      const sticker = c.kind === 'sticker' ? STICKER_VISUALS[c.key] : null;
      const visual = theme || sticker;
      if (!visual) return null;
      return {
        key: c.key,
        kind: c.kind,
        cost: c.cost,
        seasonal: c.seasonal,
        owned: ownedSet.has(c.key),
        affordable: (balance || 0) >= c.cost,
        name: visual.name,
        emoji: sticker ? sticker.emoji : null,
        theme, // {c1,c2,accent,...} for a theme swatch, else null
      };
    })
    .filter(Boolean);
}
