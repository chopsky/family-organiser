/**
 * Shared "does this event look like a gathering?" detector.
 *
 * Deliberately a keyword regex, not a model call: detection only controls how
 * PROMINENTLY the invite affordance is offered (prominent button / bot offer)
 * - never whether it's available (every event can generate an invite link
 * from its menu). A false positive is a slightly eager button; a false
 * negative still has the menu path - so a cheap transparent list beats a
 * classifier here, and it keeps the AI pipeline (and its eval gate) untouched.
 *
 * Used by: web event UI, the WhatsApp bot's create-event offer, and the
 * in-app chat's event card.
 */
const PARTY_RE = new RegExp(
  [
    'birthday', 'bday', '\\bparty\\b', 'bbq', 'barbecue', 'barbeque',
    'playdate', 'play date', 'sleepover', 'sleep over', 'picnic',
    'gathering', 'get[- ]?together', 'christening', 'baptism', 'bar mitzvah',
    'bat mitzvah', 'bonfire', 'fireworks', 'halloween', 'easter egg',
    'baby shower', 'housewarming', 'house warming', 'celebration',
    'anniversary', 'leaving do', '\\bdo\\b at', 'reunion', 'meet[- ]?up',
  ].join('|'),
  'i',
);

function looksLikeGathering(title) {
  return PARTY_RE.test(String(title || ''));
}

module.exports = { looksLikeGathering, PARTY_RE };
