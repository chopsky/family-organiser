// Single source of truth mapping a member's `color_theme` to a hex value.
// Used by the Avatar primitive, the Family page, the dashboard
// AfterSchoolCard, and anywhere a tinted member/kid accent is needed
// (tile backgrounds are built as `hexFor(member) + '1F'` ≈ 12% alpha).
//
// Mirrors the 16-colour profile palette in web/src/index.css (@theme) plus
// the three brand hues (coral / plum / sage) that older members may carry.
export const MEMBER_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  coral: '#E8724A', plum: '#6B3FA0', sage: '#7DAE82',
};

// Resolve a member's accent hex, defaulting to sage when unknown.
export const hexFor = (m) => MEMBER_HEX[m?.color_theme] || '#7DAE82';

// Flat, OPAQUE pastel tint of a member's colour, mixed with white. Used for the
// soft circle behind an illustrated avatar. Opaque (a solid hex, not an alpha)
// so overlapping avatars occlude each other cleanly; `amount` is how much of the
// member colour shows through (0 = white, 1 = the full accent).
export const tintFor = (m, amount = 0.28) => {
  const hex = hexFor(m).replace('#', '');
  const chan = (i) => parseInt(hex.slice(i, i + 2), 16);
  const mix = (c) => Math.round(255 + (c - 255) * amount);
  const to2 = (n) => n.toString(16).padStart(2, '0');
  return `#${to2(mix(chan(0)))}${to2(mix(chan(2)))}${to2(mix(chan(4)))}`;
};
