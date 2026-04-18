/**
 * Broadcast service — sends notifications to other household members
 * when someone makes a change via the bot or the app.
 *
 * Fire-and-forget: errors are logged but never block the caller.
 *
 * Recipients can opt out of specific categories via the
 * notification_preferences table (whatsapp_activity, etc.). A missing
 * preferences row is treated as "all enabled" — matches the push flow.
 */

const whatsapp = require('./whatsapp');
const db = require('../db/queries');

// Map of category name → preferences column name.
// Add new entries here as more WhatsApp broadcast categories are introduced.
const CATEGORY_PREF_COLUMN = {
  activity: 'whatsapp_activity', // task/shopping/event add + complete broadcasts
};

/**
 * Send a notification to all household members except the sender,
 * respecting each member's opt-out preference for the given category.
 *
 * @param {string}   senderId   - User ID of the person who made the change (skip them)
 * @param {object[]} members    - All household members (from db.getHouseholdMembers)
 * @param {string}   message    - The notification text
 * @param {object}   [opts]
 * @param {string}   [opts.category] - Category key (e.g. 'activity'). If set,
 *                                     recipients with the matching preference
 *                                     column = false will be skipped.
 */
async function toHousehold(senderId, members, message, { category } = {}) {
  if (!whatsapp.isConfigured()) return;

  // Shortlist deliverable recipients up-front so we only query prefs for them.
  const candidates = members.filter(
    (m) => m.id !== senderId && m.whatsapp_linked && m.whatsapp_phone
  );
  if (candidates.length === 0) return;

  // If a category is specified, look up each recipient's preference. Members
  // without a preferences row are treated as opted-in (the default).
  let prefsMap = null;
  const prefColumn = category && CATEGORY_PREF_COLUMN[category];
  if (prefColumn) {
    try {
      prefsMap = await db.getNotificationPreferencesForUsers(candidates.map((m) => m.id));
    } catch (err) {
      console.error('[broadcast] Failed to load preferences — sending to all:', err.message);
      prefsMap = null; // fall through to default-opted-in
    }
  }

  for (const member of candidates) {
    if (prefColumn && prefsMap) {
      const prefs = prefsMap.get(member.id);
      if (prefs && prefs[prefColumn] === false) continue; // opted out
    }
    whatsapp.sendMessage(member.whatsapp_phone, message).catch((err) => {
      console.error(`[broadcast] WhatsApp failed for ${member.name}:`, err.message);
    });
  }
}

module.exports = { toHousehold };
