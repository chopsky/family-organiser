/**
 * Setup-completion nudge.
 *
 * Some households connect the WhatsApp assistant (the easy hook) but never
 * cross into the app to do the high-value setup that only lives there -
 * subscribing to calendars, importing school term dates, adding their home
 * address. They think WhatsApp is the whole product and quietly miss out.
 *
 * This module detects those gaps and composes a friendly nudge that names
 * EXACTLY what's missing and the precise app screen to fix it (reusing the
 * same screen names the bot redirects to). Delivery channel is chosen per
 * member by the caller: push if they have the app installed (pulls them
 * straight in), otherwise WhatsApp.
 *
 * Copy rules (matching the rest of the app's generated/templated voice):
 * plain widely-understood words, no regional slang, commas and full stops
 * only - no em or en dashes.
 */

// The app-only setup steps we nudge about, in priority order. `where` mirrors
// the exact screen names the WhatsApp bot points users to.
const GAP_INFO = {
  calendars: {
    short: 'connect your shared calendars',
    where: 'Settings, then Connect Calendars',
  },
  schools: {
    short: "add your children's school term dates",
    where: 'Family Setup, tap each child, then Term dates',
  },
  address: {
    short: 'add your home address for local weather',
    where: 'Family Setup',
  },
};

const GAP_ORDER = ['calendars', 'schools', 'address'];

/**
 * Work out which app-only setup steps a household is missing.
 *
 * @param {object} p
 * @param {boolean} p.hasCalendarFeeds - any external calendar subscribed
 * @param {boolean} p.hasSchools       - any school set up for the household
 * @param {boolean} p.hasAddress       - a home address is saved
 * @param {boolean} p.hasChildren      - household has dependent members
 * @returns {string[]} gap keys, in priority order ([] = fully set up)
 */
function detectSetupGaps({ hasCalendarFeeds, hasSchools, hasAddress, hasChildren } = {}) {
  const gaps = [];
  if (!hasCalendarFeeds) gaps.push('calendars');
  // Only nudge about school dates when there are actually children to set up.
  if (hasChildren && !hasSchools) gaps.push('schools');
  if (!hasAddress) gaps.push('address');
  return gaps.sort((a, b) => GAP_ORDER.indexOf(a) - GAP_ORDER.indexOf(b));
}

// Join a list into "a", "a and b", "a, b and c".
function humanList(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * WhatsApp nudge body (goes through the generic {{1}} broadcast template, so
 * it's one plain-text block). Names the gaps + the screen for the first one.
 */
function buildWhatsAppNudge(name, gaps = []) {
  const firstName = (name || '').split(' ')[0] || 'there';
  const valid = gaps.filter((g) => GAP_INFO[g]);
  if (valid.length === 0) return null;

  const things = humanList(valid.map((g) => GAP_INFO[g].short));
  const where = GAP_INFO[valid[0]].where;
  return `Hi ${firstName}! You're up and running on WhatsApp, but you're missing some of the best bits of Housemait. `
    + `You haven't had a chance to ${things} yet, and those live in the app, not here in chat. `
    + `Open the Housemait app and go to ${where} to set it up. It only takes a minute, and then I'll keep handling your reminders from there. `
    + `Reply HELP if you'd like a hand.`;
}

/**
 * Push nudge ({ title, body }) for members who have the app installed but
 * rely on WhatsApp. Short, and taps straight into the app.
 */
function buildPushNudge(gaps = []) {
  const valid = gaps.filter((g) => GAP_INFO[g]);
  if (valid.length === 0) return null;
  const things = humanList(valid.map((g) => GAP_INFO[g].short));
  return {
    title: 'Finish setting up Housemait',
    body: `You haven't had a chance to ${things} yet. These live in the app. Open Housemait to set them up in a minute.`,
  };
}

module.exports = {
  GAP_INFO,
  GAP_ORDER,
  detectSetupGaps,
  buildWhatsAppNudge,
  buildPushNudge,
};
