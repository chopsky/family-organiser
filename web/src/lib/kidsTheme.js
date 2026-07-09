// Kids mode theme system — single source of truth for the 8 bright colour
// presets, the avatar emoji grid, and how a child member record resolves to
// a live theme. Mirrors the Kids design spec (design_handoff_kids/README.md):
// each kid gets an accent + gradient + soft tint + avatar emoji; switching
// kid (or picking a new colour in the Me screen) re-themes the whole surface.
//
// kid_color / kid_avatar persist on the child's users row so the theme
// follows them across devices. Members without a saved preset fall back to a
// stable default derived from their position in the kids list.

export const KID_COLOR_PRESETS = [
  // Free presets (8) - always selectable in the Me picker.
  { key: 'sky',    c1: '#5CC6FF', c2: '#2E8FE0', accent: '#3BB4F5', soft: '#E3F4FE' },
  { key: 'coral',  c1: '#FF9DBB', c2: '#F2578A', accent: '#FB6F92', soft: '#FFE7EE' },
  { key: 'grape',  c1: '#A78BFA', c2: '#7C4DE0', accent: '#8B5CF6', soft: '#EFE9FE' },
  { key: 'sun',    c1: '#FCCB5B', c2: '#E89A12', accent: '#F0A81E', soft: '#FFF3D6' },
  { key: 'mint',   c1: '#5EE0AB', c2: '#12B67E', accent: '#1FBE86', soft: '#DDF7EC' },
  { key: 'teal',   c1: '#5AD4E0', c2: '#1AA6B8', accent: '#22B4C4', soft: '#DCF5F8' },
  { key: 'orange', c1: '#FFB27A', c2: '#F2743A', accent: '#FB8C4E', soft: '#FFEBDD' },
  { key: 'berry',  c1: '#F58FD6', c2: '#D14EA8', accent: '#E86FC4', soft: '#FCE6F5' },
  // Premium themes (Phase 2 star-shop): richer, darker gradients that read as
  // special. `premium: true` keeps them out of the free-default pool and gates
  // them in the Me picker. Keys mirror src/services/kids-cosmetics.js (the
  // authoritative price/season source); colours live here for kidTheme().
  { key: 'galaxy',  premium: true, name: 'Galaxy',  c1: '#6D5BF0', c2: '#241A5E', accent: '#8B7BFF', soft: '#E9E5FF' },
  { key: 'dino',    premium: true, name: 'Dino',    c1: '#5FCF7F', c2: '#1C6E3C', accent: '#34AC59', soft: '#E1F6E7' },
  { key: 'unicorn', premium: true, name: 'Unicorn', c1: '#FF9DE6', c2: '#9B3FD6', accent: '#D96FE0', soft: '#FBE7FB' },
  { key: 'ocean',   premium: true, name: 'Ocean',   c1: '#41C7E6', c2: '#124F8E', accent: '#1F9FD6', soft: '#DDF1FB' },
];

// The free pool a kid without a chosen colour falls back to, so a premium
// theme is never assigned (or shown active) without being bought.
export const FREE_PRESETS = KID_COLOR_PRESETS.filter((p) => !p.premium);

// Decorated backdrops for the premium themes — the "world" that appears when a
// kid wears one (free themes keep the plain soft fade). Each is a light,
// text-readable base with a themed motif layered on top: galaxy sparkles,
// jungle canopy, unicorn pastels, ocean bubbles. Pure CSS (no images), static
// (reduced-motion safe). Keyed by theme key; applied as the shell background.
export const PREMIUM_SCENES = {
  // Galaxy — a dense sparkle field (gold / violet / magenta / coral) over
  // purple nebula blooms.
  galaxy: `
    radial-gradient(3px 3px at 8% 13%, #F0A81E, transparent),
    radial-gradient(2px 2px at 16% 26%, #8B7BFF, transparent),
    radial-gradient(3.5px 3.5px at 24% 8%, #D66FE0, transparent),
    radial-gradient(2px 2px at 33% 21%, #FB6F92, transparent),
    radial-gradient(2.5px 2.5px at 42% 11%, #F0A81E, transparent),
    radial-gradient(2px 2px at 51% 24%, #8B7BFF, transparent),
    radial-gradient(3.5px 3.5px at 60% 9%, #D66FE0, transparent),
    radial-gradient(2px 2px at 69% 22%, #F0A81E, transparent),
    radial-gradient(3px 3px at 78% 12%, #8B7BFF, transparent),
    radial-gradient(2.5px 2.5px at 87% 24%, #D66FE0, transparent),
    radial-gradient(3px 3px at 94% 9%, #FB6F92, transparent),
    radial-gradient(58% 42% at 18% 3%, rgba(139,123,255,0.42), transparent 70%),
    radial-gradient(54% 40% at 84% 1%, rgba(214,111,224,0.34), transparent 70%),
    linear-gradient(180deg, #E7E0FE, #FFFDF8 50%)`,
  // Dino — green leaf specks, a two-corner canopy and a rolling-hills band.
  dino: `
    radial-gradient(4px 4px at 12% 16%, rgba(31,110,60,0.85), transparent),
    radial-gradient(2.5px 2.5px at 26% 9%, rgba(52,172,89,0.85), transparent),
    radial-gradient(3.5px 3.5px at 38% 20%, rgba(31,110,60,0.8), transparent),
    radial-gradient(2.5px 2.5px at 52% 11%, rgba(52,172,89,0.85), transparent),
    radial-gradient(4px 4px at 66% 18%, rgba(31,110,60,0.85), transparent),
    radial-gradient(2.5px 2.5px at 80% 9%, rgba(52,172,89,0.85), transparent),
    radial-gradient(3.5px 3.5px at 90% 20%, rgba(31,110,60,0.8), transparent),
    radial-gradient(85% 55% at 10% 0%, rgba(52,172,89,0.36), transparent 68%),
    radial-gradient(72% 48% at 92% 2%, rgba(31,110,60,0.28), transparent 68%),
    radial-gradient(150% 42% at 50% 113%, rgba(31,110,60,0.36), transparent 60%),
    linear-gradient(180deg, #DDF3E2, #FFFDF8 52%)`,
  // Unicorn — a soft rainbow spread (pink / purple / mint) dusted with sparkles.
  unicorn: `
    radial-gradient(3px 3px at 14% 16%, #F0A81E, transparent),
    radial-gradient(2.5px 2.5px at 30% 9%, #D66FE0, transparent),
    radial-gradient(4px 4px at 46% 18%, #FF9DE6, transparent),
    radial-gradient(2.5px 2.5px at 62% 10%, #5EE0AB, transparent),
    radial-gradient(3px 3px at 78% 17%, #F0A81E, transparent),
    radial-gradient(2.5px 2.5px at 90% 9%, #D66FE0, transparent),
    radial-gradient(50% 44% at 8% 2%, rgba(255,157,230,0.46), transparent 70%),
    radial-gradient(46% 40% at 34% 0%, rgba(155,63,214,0.26), transparent 70%),
    radial-gradient(46% 40% at 62% 0%, rgba(94,224,171,0.26), transparent 70%),
    radial-gradient(50% 44% at 92% 2%, rgba(255,157,230,0.40), transparent 70%),
    linear-gradient(180deg, #FBE3FA, #FFFDF8 52%)`,
  // Ocean — rising bubbles of varied sizes over a deep-water band.
  ocean: `
    radial-gradient(15px 15px at 18% 27%, rgba(31,159,214,0.22), transparent),
    radial-gradient(9px 9px at 30% 13%, rgba(31,159,214,0.26), transparent),
    radial-gradient(6px 6px at 44% 22%, rgba(31,159,214,0.24), transparent),
    radial-gradient(12px 12px at 60% 11%, rgba(31,159,214,0.22), transparent),
    radial-gradient(7px 7px at 74% 24%, rgba(31,159,214,0.26), transparent),
    radial-gradient(5px 5px at 86% 13%, rgba(31,159,214,0.28), transparent),
    radial-gradient(70% 46% at 12% 0%, rgba(31,159,214,0.32), transparent 70%),
    radial-gradient(60% 42% at 90% 2%, rgba(18,79,142,0.24), transparent 70%),
    radial-gradient(160% 46% at 50% 115%, rgba(18,79,142,0.34), transparent 62%),
    linear-gradient(180deg, #D3EDFA, #FFFDF8 52%)`,
};

export const KID_AVATARS = ['🦖', '🦄', '🐱', '🐶', '🦊', '🐼', '🐯', '🦁', '🐵', '🐸', '🦉', '🐙', '🦕', '🐢', '🐝', '🦋', '🚀', '⚽', '🎨', '🦸', '🧚', '🤖'];

// Fixed ink/paper tokens for the Kids skin (not themed per kid).
export const KIDS_INK = { ink: '#312B4B', ink2: '#6C6690', ink3: '#A6A1C4', paper: '#FFFDF8', sun: '#FBB733', grape: '#8B5CF6' };

// A child is a dependent member record (same rule as the Rewards page).
export const isKidMember = (m) => m?.member_type === 'dependent';

const presetByKey = Object.fromEntries(KID_COLOR_PRESETS.map((p) => [p.key, p]));

/**
 * Resolve a kid's live theme from their member record. `index` (position in
 * the kids list) picks a stable default preset for kids who haven't chosen
 * one yet, so siblings start on different colours.
 */
export function kidTheme(member, index = 0) {
  // A saved kid_color resolves to any preset (incl. an owned premium theme);
  // an unset colour falls back to a FREE preset so premium is never free.
  const preset = presetByKey[member?.kid_color] || FREE_PRESETS[index % FREE_PRESETS.length];
  const emoji = member?.kid_avatar || KID_AVATARS[index % 2]; // 🦖 / 🦄 defaults per the spec
  return {
    key: preset.key,
    accent: preset.accent,
    soft: preset.soft,
    c1: preset.c1,
    c2: preset.c2,
    grad: `linear-gradient(160deg, ${preset.c1}, ${preset.c2})`,
    // Premium themes get a decorated scene; free themes keep the soft fade.
    bg: PREMIUM_SCENES[preset.key] || `radial-gradient(130% 60% at 50% 0%, ${preset.soft}, ${KIDS_INK.paper} 60%)`,
    emoji,
  };
}
