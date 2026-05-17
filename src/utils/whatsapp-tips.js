/**
 * "Did you know…" tips appended to the morning digest for the first
 * 14 days after a user links WhatsApp. One tip per day, rotating
 * through the pool below — designed so users discover the breadth
 * of what the bot can do without the welcome message having to list
 * every feature on day one.
 *
 * After day 14, the digest falls back to the standard
 *   "_Reply /help for all commands._"
 * footer so long-term users aren't trained to ignore a line that
 * always says the same thing.
 *
 * Add new tips by appending to the array. Order doesn't matter —
 * day-since-linked is hashed into an index so the order is stable
 * per-user even if the array reshuffles. Keep each tip < 90 chars
 * so it doesn't dominate the digest visually.
 */

const TIPS = [
  '💡 _Did you know:_ forward me a recipe link and I\'ll save it to your Recipe Box.',
  '💡 _Did you know:_ snap a shopping receipt and I\'ll check off the items on your shopping list.',
  '💡 _Did you know:_ say "remember the wifi password is XYZ" and I\'ll keep it safe for you.',
  '💡 _Did you know:_ ask "what\'s on this Saturday?" and I\'ll check all family calendars at once.',
  '💡 _Did you know:_ voice notes work — talk to me hands-free while driving.',
  '💡 _Did you know:_ say "I need a restaurant for date night" and I\'ll suggest some great nearby options',
  '💡 _Did you know:_ reply /tasks to see what\'s pending across the whole household.',
  '💡 _Did you know:_ ask "when are we all free next week?" and I\'ll find a shared slot.',
  '💡 _Did you know:_ snap the school newsletter — I\'ll pull dates straight into the calendar.',
  '💡 _Did you know:_ tell me "I have mince, onions and tomatoes" — I\'ll suggest a dinner.',
  '💡 _Did you know:_ forward me an email by sending it on to your personal Housemait inbox.',
  '💡 _Did you know:_ ask "what did I have for dinner last Friday?" and I\'ll check the meal plan.',
  '💡 _Did you know:_ /shopping shows your current list in one tap, no scrolling needed.',
  '💡 _Did you know:_ tell me "Netflix renews 1st of every month" and I\'ll remind you 3 days before so you can cancel if needed.',
  '💡 _Did you know:_ you can plan a whole week of meals from your Recipe Box with one ask.',
  '💡 _Did you know:_ ask "when is the next school holiday?" and I\'ll give you the dates.',
];

/** Total day-1 to day-N range during which a tip footer is shown. */
const TIP_WINDOW_DAYS = TIPS.length;

/**
 * Pick the footer for a given user.
 *
 * @param {string|Date|null} linkedAt - users.whatsapp_linked_at value
 * @returns {string} The footer line (markdown). Either a rotating tip
 *   (within the first 14 days post-link) or the standard /help line.
 */
function pickDigestFooter(linkedAt) {
  if (!linkedAt) return '_Reply /help for all commands._';
  const linked = new Date(linkedAt);
  if (Number.isNaN(linked.getTime())) return '_Reply /help for all commands._';
  // Day count is inclusive of day 0 → indexes 0..TIPS.length-1 each
  // fire once before falling back to the standard footer.
  const dayIndex = Math.floor((Date.now() - linked.getTime()) / 86400000);
  if (dayIndex < 0 || dayIndex >= TIP_WINDOW_DAYS) {
    return '_Reply /help for all commands._';
  }
  return TIPS[dayIndex];
}

module.exports = { pickDigestFooter, TIPS, TIP_WINDOW_DAYS };
