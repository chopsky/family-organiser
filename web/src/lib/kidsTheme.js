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
  { key: 'galaxy',  premium: true, dark: true, name: 'Galaxy',  c1: '#8B7BFF', c2: '#3B2E7E', accent: '#A78BFA', soft: '#E9E5FF' },
  { key: 'dino',    premium: true, dark: true, name: 'Dino',    c1: '#4FBE72', c2: '#155230', accent: '#5FCF7F', soft: '#E1F6E7' },
  { key: 'unicorn', premium: true, dark: true, name: 'Unicorn', c1: '#FF9DE6', c2: '#7C3AC4', accent: '#F58FD6', soft: '#FBE7FB' },
  { key: 'ocean',   premium: true, dark: true, name: 'Ocean',   c1: '#3AC0E6', c2: '#0E3E6E', accent: '#5AD4E0', soft: '#DDF1FB' },
];

// The free pool a kid without a chosen colour falls back to, so a premium
// theme is never assigned (or shown active) without being bought.
export const FREE_PRESETS = KID_COLOR_PRESETS.filter((p) => !p.premium);

// Immersive DARK backdrops for the premium themes — the "world" that appears
// when a kid wears one (free themes keep the plain light fade). Deep base with
// bright decoration: a galaxy starfield, a night jungle with fireflies, a
// magical unicorn night, a deep sea with bubbles. Pure CSS (no images), static
// (reduced-motion safe). Kids screens go light-on-dark when the theme is dark
// (see kidTheme's onInk tokens). Keyed by theme key; applied as the shell bg.
export const PREMIUM_SCENES = {
  // Galaxy — a bright starfield (white / gold / lilac) over a deep-space nebula.
  galaxy: `
    radial-gradient(1.5px 1.5px at 6% 14%, #fff, transparent),
    radial-gradient(2px 2px at 13% 30%, rgba(255,255,255,0.9), transparent),
    radial-gradient(1.5px 1.5px at 21% 9%, #FFE08A, transparent),
    radial-gradient(2.5px 2.5px at 29% 24%, #fff, transparent),
    radial-gradient(1.5px 1.5px at 37% 13%, rgba(255,255,255,0.85), transparent),
    radial-gradient(2px 2px at 45% 28%, #C9BEFF, transparent),
    radial-gradient(1.5px 1.5px at 53% 10%, #fff, transparent),
    radial-gradient(2.5px 2.5px at 61% 22%, #FFE08A, transparent),
    radial-gradient(1.5px 1.5px at 69% 13%, rgba(255,255,255,0.9), transparent),
    radial-gradient(2px 2px at 77% 27%, #fff, transparent),
    radial-gradient(1.5px 1.5px at 85% 10%, #C9BEFF, transparent),
    radial-gradient(2.5px 2.5px at 92% 24%, #fff, transparent),
    radial-gradient(1.5px 1.5px at 97% 14%, #FFE08A, transparent),
    radial-gradient(72% 55% at 20% 0%, rgba(139,123,255,0.45), transparent 70%),
    radial-gradient(62% 50% at 85% 4%, rgba(214,111,224,0.35), transparent 70%),
    linear-gradient(180deg, #221A52, #120C2C)`,
  // Dino — golden fireflies + light leaves over a night canopy and dark hills.
  dino: `
    radial-gradient(2px 2px at 10% 12%, #FFDD6B, transparent),
    radial-gradient(2.5px 2.5px at 24% 24%, #FFDD6B, transparent),
    radial-gradient(2px 2px at 40% 10%, #A8F0B8, transparent),
    radial-gradient(2.5px 2.5px at 58% 22%, #FFDD6B, transparent),
    radial-gradient(2px 2px at 74% 12%, #A8F0B8, transparent),
    radial-gradient(2.5px 2.5px at 88% 24%, #FFDD6B, transparent),
    radial-gradient(90% 55% at 8% 0%, rgba(46,140,74,0.5), transparent 68%),
    radial-gradient(75% 48% at 94% 2%, rgba(20,90,48,0.42), transparent 68%),
    radial-gradient(150% 46% at 50% 114%, rgba(9,60,32,0.6), transparent 60%),
    linear-gradient(180deg, #15532F, #0A2E1B)`,
  // Unicorn — a magical night: white/gold sparkles + a pink/purple/teal glow.
  unicorn: `
    radial-gradient(2px 2px at 10% 14%, #fff, transparent),
    radial-gradient(2.5px 2.5px at 26% 26%, #FFE08A, transparent),
    radial-gradient(2px 2px at 44% 10%, #fff, transparent),
    radial-gradient(2.5px 2.5px at 62% 22%, #FFB3EC, transparent),
    radial-gradient(2px 2px at 80% 12%, #fff, transparent),
    radial-gradient(2.5px 2.5px at 92% 24%, #FFE08A, transparent),
    radial-gradient(55% 48% at 10% 0%, rgba(255,120,210,0.42), transparent 70%),
    radial-gradient(50% 44% at 40% 2%, rgba(150,90,240,0.36), transparent 70%),
    radial-gradient(50% 44% at 68% 2%, rgba(90,210,220,0.30), transparent 70%),
    radial-gradient(55% 48% at 94% 0%, rgba(255,120,210,0.36), transparent 70%),
    linear-gradient(180deg, #3A1D5E, #201038)`,
  // Ocean — rising bubbles + a sunlit surface glow over deep navy water.
  ocean: `
    radial-gradient(14px 14px at 16% 30%, rgba(160,225,245,0.16), transparent),
    radial-gradient(9px 9px at 30% 16%, rgba(160,225,245,0.20), transparent),
    radial-gradient(6px 6px at 46% 26%, rgba(160,225,245,0.18), transparent),
    radial-gradient(12px 12px at 62% 13%, rgba(160,225,245,0.16), transparent),
    radial-gradient(7px 7px at 78% 26%, rgba(160,225,245,0.20), transparent),
    radial-gradient(5px 5px at 90% 15%, rgba(160,225,245,0.24), transparent),
    radial-gradient(130% 55% at 50% -12%, rgba(90,205,235,0.40), transparent 62%),
    linear-gradient(180deg, #114E86, #08243F)`,
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
  const dark = !!preset.dark;
  return {
    key: preset.key,
    accent: preset.accent,
    soft: preset.soft,
    c1: preset.c1,
    c2: preset.c2,
    dark,
    // Text/chrome that sits directly ON the themed background goes light on a
    // dark theme, standard ink on a light one. Text INSIDE the white cards keeps
    // the fixed dark KIDS_INK (the white card provides its own contrast).
    onInk: dark ? '#FCFAFF' : KIDS_INK.ink,
    onInk2: dark ? 'rgba(255,255,255,0.76)' : KIDS_INK.ink2,
    onInk3: dark ? 'rgba(255,255,255,0.54)' : KIDS_INK.ink3,
    // Translucent surface for the rail/nav chrome, so it reads on either base.
    chrome: dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.6)',
    chromeBorder: dark ? 'rgba(255,255,255,0.16)' : 'rgba(49,43,75,0.06)',
    grad: `linear-gradient(160deg, ${preset.c1}, ${preset.c2})`,
    // Premium themes get a decorated scene; free themes keep the soft fade.
    bg: PREMIUM_SCENES[preset.key] || `radial-gradient(130% 60% at 50% 0%, ${preset.soft}, ${KIDS_INK.paper} 60%)`,
    emoji,
  };
}
