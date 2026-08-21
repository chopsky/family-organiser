/**
 * Onboarding v4 copy and content data, verbatim from the handoff.
 *
 * Kept in one module so copy changes never mean touching layout code, and so
 * the benefit mapping (pain -> what we promise) sits next to the pains it
 * answers. UK English throughout, per the spec; note the curly apostrophes -
 * they're intentional and match the designed screens.
 */

/** Screen 02 pain picker. `ben` drives the personalised plan on screen 03. */
export const PAINS = [
  { id: 'calendar', emoji: '📅', label: 'Calendar chaos', note: 'Clashes, pickups, who’s where',
    ben: { t: 'One family calendar', d: 'School, work and clubs in the same week view.' } },
  { id: 'chores', emoji: '🧹', label: 'Chore wars', note: 'Whose turn is it, again',
    ben: { t: 'Chores that share themselves', d: 'Fair rotas and friendly nudges. Not all on you.' } },
  { id: 'shopping', emoji: '🛒', label: 'Shopping-list roulette', note: 'Two lots of milk, no bread',
    ben: { t: 'Lists that update live', d: 'Add it once. Whoever’s at the shop sees it.' } },
  { id: 'meals', emoji: '🍽️', label: 'The dinner question', note: 'Asked at 5pm, every day',
    ben: { t: 'Dinner, decided', d: 'Plan the week and the shop list builds itself.' } },
  { id: 'school', emoji: '🎒', label: 'School admin', note: 'Letters, kit, dress-up days',
    ben: { t: 'School admin, caught', d: 'Term dates and non-uniform days, filed for you.' } },
  { id: 'mental', emoji: '🧠', label: 'The mental load', note: 'It all lives in your head',
    ben: { t: 'A second brain for your home', d: 'Housemait remembers it so nobody has to.' } },
];

/**
 * Always the third row on the paywall, whatever the family picked. It is
 * the one thing no rival family organiser has, and the likeliest single
 * reason someone pays rather than shrugs - so it never rotates out.
 */
export const WHATSAPP_BEN = {
  emoji: '💬',
  t: 'Runs on WhatsApp',
  d: 'Forward a school letter, the dates add themselves.',
};

/** Someone who skipped the picker still gets a plan - these two are the default. */
export const PAINS_FALLBACK = ['calendar', 'mental'];

/** Screen 04 household shape. */
export const SHAPES = [
  { id: 'couple', emoji: '💞', label: 'Just us two', note: 'Two calendars, one home' },
  { id: 'kids', emoji: '🧸', label: 'Family with kids', note: 'The full house' },
  { id: 'single', emoji: '💪', label: 'Single-parent crew', note: 'Doing it all, brilliantly' },
  { id: 'multigen', emoji: '🏡', label: 'Multi-gen household', note: 'Grandparents in the mix' },
  { id: 'mates', emoji: '🤝', label: 'Housemates', note: 'Bills, bins and rotas' },
];

/**
 * Screen 06 role chips - the app's canonical family roles, NOT the handoff's
 * list. The handoff shipped Mum/Dad/Grandparent/Carer/Housemate, none of
 * which exist in lib/familyRoles: whatever is picked here becomes the
 * member's family_role, and a value outside that list haunts the Family
 * page's dropdowns forever as a legacy extra option. One import, one truth -
 * if the founder trims the list again, this screen follows.
 */
export { FAMILY_ROLES as ROLES } from '../../lib/familyRoles';

/**
 * Screen 01 sticky-note pile. The fade down the stack is deliberate - the
 * further down, the more "buried" the thought. `r` is rotation, `o` final
 * opacity; both are handed to the obRiseR keyframe so nothing snaps on entry.
 */
export const NOTES = [
  { t: 'Bins night, whose turn?', x: { left: 2, top: 0 }, r: -6, o: 1 },
  { t: 'PE kit. Again.', x: { right: 0, top: 38 }, r: 4.5, o: 1 },
  { t: 'Dentist Tue 3pm', x: { left: 14, top: 78 }, r: 2.5, o: 0.78 },
  { t: 'Milk. And bread.', x: { right: 10, top: 118 }, r: -3.5, o: 0.5 },
  { t: 'Non-uniform day tomorrow?!', x: { left: 0, top: 150 }, r: -1.5, o: 0.26 },
];

/** Screen 07 household-name suggestions. Third is personalised from the name. */
export const houseSuggestions = (firstName) => [
  'The Nest',
  'Base Camp',
  firstName ? `Casa ${firstName}` : 'Home HQ',
];

/** Screen 03 opener - acknowledges how many pains they picked. */
export const planOpener = (n) => (n === 1 ? 'A classic, that one.' : `Oof, ${n} of the classics.`);
