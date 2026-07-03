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
  { key: 'sky',    c1: '#5CC6FF', c2: '#2E8FE0', accent: '#3BB4F5', soft: '#E3F4FE' },
  { key: 'coral',  c1: '#FF9DBB', c2: '#F2578A', accent: '#FB6F92', soft: '#FFE7EE' },
  { key: 'grape',  c1: '#A78BFA', c2: '#7C4DE0', accent: '#8B5CF6', soft: '#EFE9FE' },
  { key: 'sun',    c1: '#FCCB5B', c2: '#E89A12', accent: '#F0A81E', soft: '#FFF3D6' },
  { key: 'mint',   c1: '#5EE0AB', c2: '#12B67E', accent: '#1FBE86', soft: '#DDF7EC' },
  { key: 'teal',   c1: '#5AD4E0', c2: '#1AA6B8', accent: '#22B4C4', soft: '#DCF5F8' },
  { key: 'orange', c1: '#FFB27A', c2: '#F2743A', accent: '#FB8C4E', soft: '#FFEBDD' },
  { key: 'berry',  c1: '#F58FD6', c2: '#D14EA8', accent: '#E86FC4', soft: '#FCE6F5' },
];

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
  const preset = presetByKey[member?.kid_color] || KID_COLOR_PRESETS[index % KID_COLOR_PRESETS.length];
  const emoji = member?.kid_avatar || KID_AVATARS[index % 2]; // 🦖 / 🦄 defaults per the spec
  return {
    key: preset.key,
    accent: preset.accent,
    soft: preset.soft,
    c1: preset.c1,
    c2: preset.c2,
    grad: `linear-gradient(160deg, ${preset.c1}, ${preset.c2})`,
    bg: `radial-gradient(130% 60% at 50% 0%, ${preset.soft}, ${KIDS_INK.paper} 60%)`,
    emoji,
  };
}
