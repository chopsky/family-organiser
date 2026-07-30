// Family-role options — shared by the add/edit member forms (FamilySetup)
// and the onboarding-v4 role step, so the roles a household can pick are the
// same everywhere by construction.
//
// Merged list (founder call, 2026-07-30), replacing the July trim: the
// vernacular Mum/Dad wins over the census-form Mother/Father — this label
// shows on member cards and in the bot's context ("Lynn (Mum)"), and warmth
// is the brand. Housemate and Carer exist because the v4 shape picker
// promises "Housemates — bills, bins and rotas" as a household type, and a
// role list that can't describe a member of an advertised household shape
// contradicts the product. One Grandparent chip, not two gendered ones.
// Other stays as the escape hatch — a list without it forces a lie from
// every aunt and lodger.
//
// Values already stored under the old list (Mother, Grandmother, …) keep
// displaying and re-saving fine: the dropdowns append the current value as
// an extra option whenever it isn't listed.

// Countries whose English says "Mom". Everyone else — UK, Ireland,
// Australia, New Zealand, and the rest of the world by default — gets "Mum".
const MOM_COUNTRIES = new Set(['US', 'CA', 'ZA']);

/**
 * The role options for a household in `country` (ISO-3166 alpha-2).
 *
 * Falls back to the device locale's region when no country is given — the
 * onboarding role step runs BEFORE the household exists, so the locale is
 * the only signal it has. The picked label is stored as-is: a Johannesburg
 * household keeps "Mom" everywhere, with no mapping layer, because every
 * surface that reads family_role shows it verbatim.
 */
export function familyRolesFor(country) {
  const cc = (
    country ||
    (typeof navigator !== 'undefined' && (navigator.language || '').split('-')[1]) ||
    'GB'
  ).toUpperCase();
  return [
    MOM_COUNTRIES.has(cc) ? 'Mom' : 'Mum',
    'Dad',
    'Parent',
    'Partner',
    'Grandparent',
    'Carer',
    'Housemate',
    // Older kids with their own logins are ACCOUNT members (invited like any
    // adult), so the dependent Child/Pet toggle never applies to them - this
    // is the only place a teen's account can be labelled as a child. Display
    // + chat-AI context only; it does NOT gate kid features or permissions.
    'Child',
    'Other',
  ];
}

// Locale-default list for surfaces with no household yet (onboarding v4).
export const FAMILY_ROLES = familyRolesFor();
