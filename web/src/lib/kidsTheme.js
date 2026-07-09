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
  // Premium themes (Phase 2 star-shop). Each carries its FULL token bundle
  // (background + ink + card + chrome) so it can be a distinct "world", matching
  // the design preview (design_handoff_kids / kids-themes-preview.html).
  // `premium: true` keeps them out of the free-default pool and gates them in
  // the Me picker. `dark`/`deco` drive the shell: only GALAXY is a dark,
  // frosted-glass world; Dino / Ocean / Candy are bright & LIGHT (dark ink on a
  // vivid gradient, solid-white cards). Keys mirror src/services/kids-cosmetics.js
  // (the authoritative price/season source) — NOTE the pink theme's key is
  // 'unicorn' but it DISPLAYS as "Candy" (key kept for back-compat with
  // already-purchased cosmetics; only the look + name changed).
  { key: 'galaxy', premium: true, dark: true, deco: 'stars', name: 'Galaxy',
    c1: '#A78BFA', c2: '#EC4899', accent: '#8B5CF6', soft: '#EDE7FF',
    bg: 'radial-gradient(120% 80% at 50% 0%, #3A2A6E 0%, #1E1640 55%, #130E2B 100%)',
    ink: '#F1EBFF', ink2: '#B7ABE2', ink3: 'rgba(241,235,255,0.55)',
    chrome: 'rgba(255,255,255,0.10)', chromeBorder: 'rgba(167,139,250,0.28)', chip: 'rgba(167,139,250,0.22)', sel: 'rgba(255,255,255,0.17)',
    card: 'rgba(255,255,255,0.08)', cardBorder: 'rgba(167,139,250,0.30)', cardShadow: '0 10px 30px rgba(8,4,24,0.35)', cardBlur: 'blur(10px)',
    cardText: '#F1EBFF', cardText2: 'rgba(241,235,255,0.74)', cardText3: 'rgba(241,235,255,0.52)' },
  { key: 'dino', premium: true, dark: false, deco: 'jungle', name: 'Dino',
    c1: '#6FCB6A', c2: '#2FA98B', accent: '#3FA97C', soft: '#E1F2D6',
    bg: 'radial-gradient(120% 80% at 50% 0%, #DBF1CC 0%, #EDF7E2 55%, #F1F8E9 100%)',
    ink: '#2E3D1C', ink2: '#6E8258', ink3: '#9AAE84',
    chrome: 'rgba(255,255,255,0.7)', chromeBorder: 'rgba(46,61,28,0.08)', chip: '#E1F2D6', sel: '#E1F2D6',
    card: '#fff', cardBorder: 'rgba(46,61,28,0.08)', cardShadow: '0 5px 14px -4px rgba(46,61,28,0.16)', cardBlur: 'none',
    cardText: '#2E3D1C', cardText2: '#6E8258', cardText3: '#9AAE84' },
  { key: 'ocean', premium: true, dark: false, deco: 'bubbles', name: 'Ocean',
    c1: '#38BDF8', c2: '#0E7490', accent: '#0E9BC4', soft: '#CFEFFB',
    bg: 'radial-gradient(120% 90% at 50% 0%, #7DD3F0 0%, #43A6D6 45%, #1E7BB0 100%)',
    ink: '#062B3D', ink2: '#2C6A8A', ink3: '#5A8CA6',
    chrome: 'rgba(255,255,255,0.55)', chromeBorder: 'rgba(6,43,61,0.08)', chip: '#CFEFFB', sel: '#CFEFFB',
    card: 'rgba(255,255,255,0.94)', cardBorder: 'rgba(6,43,61,0.06)', cardShadow: '0 6px 16px -4px rgba(6,43,61,0.22)', cardBlur: 'none',
    cardText: '#062B3D', cardText2: '#2C6A8A', cardText3: '#5A8CA6' },
  { key: 'unicorn', premium: true, dark: false, deco: 'sprinkles', name: 'Candy',
    c1: '#FB7DC0', c2: '#A855F7', accent: '#D651A8', soft: '#FCDCF0',
    bg: 'radial-gradient(120% 90% at 50% 0%, #FFE0F0 0%, #FCE7F8 55%, #FBEFFB 100%)',
    ink: '#5A1E52', ink2: '#A76399', ink3: '#C48CB8',
    chrome: 'rgba(255,255,255,0.7)', chromeBorder: 'rgba(90,30,82,0.08)', chip: '#FCDCF0', sel: '#FCDCF0',
    card: '#fff', cardBorder: 'rgba(90,30,82,0.08)', cardShadow: '0 5px 14px -4px rgba(90,30,82,0.16)', cardBlur: 'none',
    cardText: '#5A1E52', cardText2: '#A76399', cardText3: '#C48CB8' },
];

// The free pool a kid without a chosen colour falls back to, so a premium
// theme is never assigned (or shown active) without being bought.
export const FREE_PRESETS = KID_COLOR_PRESETS.filter((p) => !p.premium);

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
  // Premium themes carry their own full token bundle; free themes (and any
  // token a preset omits) fall back to the standard light Kids skin. Only a
  // `dark` theme (Galaxy) uses frosted-glass cards + light-on-dark text; the
  // bright themes (Dino / Ocean / Candy) are dark-ink-on-vivid with solid cards.
  return {
    key: preset.key,
    accent: preset.accent,
    soft: preset.soft,
    c1: preset.c1,
    c2: preset.c2,
    dark,
    // Text that sits directly ON the themed background.
    onInk: preset.ink || KIDS_INK.ink,
    onInk2: preset.ink2 || KIDS_INK.ink2,
    onInk3: preset.ink3 || KIDS_INK.ink3,
    // Rail / nav chrome (translucent surface over the scene).
    chrome: preset.chrome || 'rgba(255,255,255,0.6)',
    chromeBorder: preset.chromeBorder || 'rgba(49,43,75,0.06)',
    // Card surface + in-card text. Galaxy is frosted glass (translucent + blur +
    // glowing border + light text); every other theme is a solid card, dark ink.
    card: preset.card || '#fff',
    cardBorder: preset.cardBorder || 'rgba(49,43,75,0.06)',
    cardShadow: preset.cardShadow || '0 6px 0 rgba(49,43,75,0.05), 0 10px 20px rgba(49,43,75,0.06)',
    cardText: preset.cardText || KIDS_INK.ink,
    cardText2: preset.cardText2 || KIDS_INK.ink2,
    cardText3: preset.cardText3 || KIDS_INK.ink3,
    cardBlur: preset.cardBlur || 'none',
    // Selected/active surface (a picked badge, an "on" toggle, today's cell) and
    // the in-card icon tile (emoji chips, avatar swatches).
    cardSel: preset.sel || preset.soft,
    cardIcon: preset.chip || '#F3F0FB',
    deco: preset.deco || null,
    grad: `linear-gradient(160deg, ${preset.c1}, ${preset.c2})`,
    // Premium themes carry a full scene; free themes keep the soft fade.
    bg: preset.bg || `radial-gradient(130% 60% at 50% 0%, ${preset.soft}, ${KIDS_INK.paper} 60%)`,
    emoji,
  };
}
