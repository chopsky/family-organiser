/**
 * Detect + subscribe an iCal feed URL pasted into WhatsApp.
 *
 * The 2026-06-01 churn transcript: a parent pasted their Google Calendar
 * private iCal URL to connect their calendar, and the bot replied "Good
 * morning! How can I help you today?" - it didn't recognise a calendar
 * URL at all. This closes that gap: when a message is (or contains) a
 * calendar feed URL, we subscribe it as an external feed and do an
 * immediate pull, exactly like the Settings "Subscribe to calendar" flow.
 */

// db + externalFeed are lazy-required inside subscribeCalendarFeed so the
// pure detection helpers (detectCalendarFeedUrl / isCalendarFeedUrl) can be
// imported - and unit-tested - without booting the Supabase client.

// Pull the first URL-ish token out of a message. People paste the bare
// URL, sometimes with surrounding words ("here's my calendar: https://...").
function firstUrl(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/\b(?:webcal|https?):\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[.,)\]]+$/, '') : null; // strip trailing punctuation
}

/**
 * Is this URL an iCal/ICS calendar feed we can subscribe to?
 * Covers the common providers' published-feed shapes plus any *.ics.
 */
function isCalendarFeedUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.startsWith('webcal://')) return true;            // any webcal feed
  if (/\.ics(\?|$)/.test(u)) return true;                // any .ics file
  if (/calendar\.google\.com\/calendar\/ical\//.test(u)) return true; // Google
  if (/icloud\.com\/published\//.test(u)) return true;   // iCloud published
  if (/outlook\.(office365\.com|live\.com).*\/calendar/.test(u)) return true; // Outlook publish
  return false;
}

/**
 * Detect a calendar feed URL anywhere in the message. Returns the URL or
 * null. (Separate from the broader "is the whole message a URL" because
 * users often paste the link with a sentence around it.)
 */
function detectCalendarFeedUrl(text) {
  const url = firstUrl(text);
  return isCalendarFeedUrl(url) ? url : null;
}

// Friendly name for the subscribed calendar, inferred from the host.
function feedDisplayName(url) {
  const u = url.toLowerCase();
  if (u.includes('google.com')) return 'Google Calendar';
  if (u.includes('icloud.com')) return 'Apple Calendar';
  if (u.includes('outlook') || u.includes('office365')) return 'Outlook Calendar';
  return 'Subscribed calendar';
}

/**
 * Subscribe the feed for this household and trigger an initial pull.
 * Returns a bot-handler-shaped { response, actions } object.
 *
 * Idempotent-ish: a duplicate URL (unique violation) is reported as
 * "already connected" rather than an error.
 */
async function subscribeCalendarFeed(url, user, household) {
  const db = require('../db/queries');
  const externalFeed = require('../services/externalFeed');
  const actions = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [], eventsAdded: [] };
  const normalised = externalFeed.normaliseFeedUrl(url);
  const displayName = feedDisplayName(url);

  let feed;
  try {
    feed = await db.createExternalFeed({
      user_id: user.id,
      household_id: household.id,
      feed_url: normalised,
      display_name: displayName,
      color: 'sky',
    });
  } catch (err) {
    if (err?.code === '23505') {
      return {
        response: `📅 That calendar is already connected to your household — its events show up in Housemait automatically.`,
        actions,
      };
    }
    console.warn('[calendar-url] createExternalFeed failed:', err.message);
    return {
      response: `I spotted a calendar link but couldn't connect it just now. Please try again in a moment, or add it under Settings → Connect Calendars.`,
      actions,
    };
  }

  // Initial pull so the user sees events appear immediately. If the
  // source is briefly down we still keep the subscription (the cron
  // retries) and tell the user it's connected.
  let count = 0;
  try {
    const stats = await externalFeed.refreshFeed(feed);
    count = stats?.created ?? stats?.imported ?? stats?.count ?? 0;
  } catch (err) {
    console.warn('[calendar-url] initial refreshFeed failed:', err.message);
    return {
      response: `📅 Connected your ${displayName}! It's syncing now — events should appear in Housemait within a minute or two.`,
      actions,
    };
  }

  return {
    response: count > 0
      ? `📅 Connected your ${displayName} and pulled in ${count} event${count !== 1 ? 's' : ''}. They'll keep syncing automatically.`
      : `📅 Connected your ${displayName}! New events will appear in Housemait automatically as they're added.`,
    actions,
  };
}

module.exports = { detectCalendarFeedUrl, isCalendarFeedUrl, subscribeCalendarFeed, firstUrl, feedDisplayName };
