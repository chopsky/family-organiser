// Shared after-school activity glyphs + free-text → glyph mapping.
// Line icons, 24px viewBox, 1.7px stroke, tinted to the child's colour.
// Used by the dashboard AfterSchoolCard and the Family page Activities
// section so both render identical glyphs from one source of truth.

const wrap = (children, p) => (
  <svg
    width={p.size || 20}
    height={p.size || 20}
    viewBox="0 0 24 24"
    fill="none"
    stroke={p.color || 'currentColor'}
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ACTIVITY_ICONS = {
  ball: (p = {}) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 3l2.6 4.5h-5.2L12 3zM3.3 9.6l4.8.6 1.6 5-4 2.6-2.4-8.2zM20.7 9.6l-2.4 8.2-4-2.6 1.6-5 4.8-.6zM8.5 19.5L12 16l3.5 3.5" /></>, p),
  tennis: (p = {}) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6a13 13 0 0 0 0 12.8M18.4 5.6a13 13 0 0 1 0 12.8" /></>, p),
  art: (p = {}) => wrap(<><path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.4-1-1.6-1-2.8 0-.8.7-1.2 1.6-1.2H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="11" cy="7.5" r="1" /><circle cx="15.5" cy="8.5" r="1" /></>, p),
  ballet: (p = {}) => wrap(<><circle cx="12" cy="4.5" r="2" /><path d="M12 7v6M12 13l-4 8M12 13l4 8M7 10l5 3 5-3" /></>, p),
  code: (p = {}) => wrap(<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />, p),
  swim: (p = {}) => wrap(<><circle cx="15" cy="7" r="2" /><path d="M5 13l4-2.5 3 2 2.5-1.5M3 17.5c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1M8.5 11.5L12 8l-2-1.5" /></>, p),
  music: (p = {}) => wrap(<><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="15.5" r="2.5" /><path d="M9 17.5V6l11-2v9.5" /><path d="M9 9l11-2" /></>, p),
  gym: (p = {}) => wrap(<path d="M2 9v6M5 7v10M19 7v10M22 9v6M5 12h14" />, p),
  // chef's hat - cooking / baking
  chef: (p = {}) => wrap(<><path d="M6 13.5h12V18a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-4.5z" /><path d="M6 13.5a3 3 0 0 1-.8-5.9A3.5 3.5 0 0 1 12 6a3.5 3.5 0 0 1 6.8 1.6 3 3 0 0 1-.8 5.9" /></>, p),
  // generic fallback
  star: (p = {}) => wrap(<path d="M12 3l2.5 5.6 6 .6-4.5 4 1.3 6L12 16.8 6.7 19.2l1.3-6-4.5-4 6-.6L12 3z" />, p),
};

// Map a free-text activity name to a glyph key.
export function iconFor(name) {
  const n = (name || '').toLowerCase();
  if (/foot|soccer|rugby|netball|hockey|cricket|\bball\b/.test(n)) return 'ball';
  if (/tennis|badminton|squash/.test(n)) return 'tennis';
  if (/art|paint|draw|craft|pottery/.test(n)) return 'art';
  if (/ballet|dance|dancing/.test(n)) return 'ballet';
  if (/cod(e|ing)|computer|ict|programming|robot/.test(n)) return 'code';
  if (/swim|water polo|diving/.test(n)) return 'swim';
  if (/choir|music|sing|band|orchestra|instrument/.test(n)) return 'music';
  if (/cook|bak(e|ing)|chef|cuisine|culinary|food/.test(n)) return 'chef';
  if (/gym|\bpe\b|sport|athletic|fitness/.test(n)) return 'gym';
  return 'star';
}
