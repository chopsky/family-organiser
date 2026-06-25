// Pure content + mapping for the onboarding pain-point and plan steps.
// British English, benefit-led, no em dashes. Kept dependency-free so it is
// trivially correct and unit-testable.

// Step 2: pick what is heaviest. Multi-select; tailors the plan screen.
export const PAIN_OPTIONS = [
  { id: 'head',  emoji: '🧠', title: "It's all in my head",   sub: 'Remembering everything, for everyone' },
  { id: 'nag',   emoji: '🔁', title: 'The endless nagging',    sub: 'Chasing the kids on their chores' },
  { id: 'run',   emoji: '🚗', title: "Who's getting who?",     sub: 'School runs, clubs and pickups' },
  { id: 'lists', emoji: '📝', title: 'Lists everywhere',       sub: 'Shopping and to-dos across five apps' },
  { id: 'share', emoji: '⚖️', title: "It's not shared",        sub: 'One of us carries it all' },
];

// Step 3: the plan. One benefit card per chosen pain point.
export const BENEFITS = {
  head:  { icon: '🗓️', title: 'One shared brain for the house', sub: 'Calendar, lists, chores and school dates in a single calm place, out of your head.' },
  nag:   { icon: '⭐',  title: 'Chores that run themselves',     sub: 'Kids see their own list and earn stars for done jobs. No more nagging.' },
  run:   { icon: '🚗',  title: 'Everyone sees the school run',   sub: "Clubs, pickups and term dates shared, so “who's getting who?” is already answered." },
  lists: { icon: '🛒',  title: 'Every list, in one place',       sub: "Shopping, packing, to-dos, shared live with whoever's closest to the shop." },
  share: { icon: '⚖️',  title: 'The load, actually shared',      sub: 'Assign anything to anyone. Both grown-ups see the whole picture, not just one.' },
};

// Resolve the benefit cards for a set of chosen pains, preserving option order
// and falling back to a sensible default when nothing is selected.
export function benefitsFor(pains) {
  const chosen = (pains || []).filter((id) => BENEFITS[id]);
  const ids = chosen.length ? chosen : ['head', 'nag', 'share'];
  // De-dupe + keep PAIN_OPTIONS order for a stable, pleasant layout.
  const order = PAIN_OPTIONS.map((o) => o.id);
  return [...new Set(ids)]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((id) => ({ id, ...BENEFITS[id] }));
}
