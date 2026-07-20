// Pre-filled options for the "Family role" dropdown — shared by the add/edit
// family-member forms (FamilySetup) and a member's own profile (Settings).
//
// Adults only: dependents carry a Child/Pet kind instead of a role, so this
// list describes the grown-ups who can hold accounts. Deliberately short
// (founder trim, 2026-07-20) — the role labels member cards and tells the
// chat AI who's who ("Lynn (Mother)"), and a long list of relatives added
// noise without adding meaning. Legacy values outside this list still
// display and re-save fine: the dropdowns append the current value as an
// extra option when it isn't listed.
export const FAMILY_ROLES = [
  'Mother',
  'Father',
  'Parent',
  'Partner',
  // Older kids with their own logins are ACCOUNT members (invited like any
  // adult), so the dependent Child/Pet toggle never applies to them - this
  // is the only place a teen's account can be labelled as a child. Display
  // + chat-AI context only; it does NOT gate kid features or permissions.
  'Child',
  'Grandmother',
  'Grandfather',
  'Guardian',
  'Other',
];
