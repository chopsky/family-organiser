/**
 * "Does this event look like a gathering?" - web twin of the backend's
 * src/utils/party-detect.js (keep the keyword lists in sync).
 *
 * Detection only controls how PROMINENTLY the invite affordance is shown -
 * never whether it's available (every saved event can create an invite link
 * from its editor). A false positive is a slightly eager card; a false
 * negative still has the quiet path.
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

export function looksLikeGathering(title) {
  return PARTY_RE.test(String(title || ''));
}
