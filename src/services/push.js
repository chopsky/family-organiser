/**
 * Apple Push Notification service (APNs) — sends push notifications
 * to iOS devices via the `apn` (node-apn) package.
 *
 * Fire-and-forget: errors are logged but never block the caller.
 * If APNs is not configured (missing env vars), all send functions
 * become silent no-ops so the app works fine without push.
 */

const apn = require('apn');
const db = require('../db/queries');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const APN_KEY_ID = process.env.APN_KEY_ID;
const APN_TEAM_ID = process.env.APN_TEAM_ID;
const APN_KEY = process.env.APN_KEY; // .p8 key contents as env var (newlines as \n)
const APN_KEY_PATH = process.env.APN_KEY_PATH; // alternative: path to .p8 file
const APN_BUNDLE_ID = process.env.APN_BUNDLE_ID || 'com.housemait.app';
const APN_PRODUCTION = process.env.APN_PRODUCTION === 'true';

let provider = null;
let configured = false;

if (APN_KEY_ID && APN_TEAM_ID && (APN_KEY || APN_KEY_PATH)) {
  try {
    const tokenConfig = {
      keyId: APN_KEY_ID,
      teamId: APN_TEAM_ID,
    };
    if (APN_KEY) {
      // Key contents passed directly as env var
      tokenConfig.key = APN_KEY.replace(/\\n/g, '\n');
    } else {
      // Key loaded from file path
      tokenConfig.key = require('fs').readFileSync(APN_KEY_PATH);
    }
    provider = new apn.Provider({ token: tokenConfig, production: APN_PRODUCTION });
    configured = true;
    console.log('[push] APNs provider initialised', APN_PRODUCTION ? '(production)' : '(sandbox)');
  } catch (err) {
    console.warn('[push] Failed to initialise APNs provider:', err.message);
  }
} else {
  console.warn('[push] APNs not configured — need APN_KEY_ID, APN_TEAM_ID, and APN_KEY (or APN_KEY_PATH). Push notifications disabled.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = [
  'calendar_reminders',
  'task_assigned',
  'shopping_updated',
  'meal_plan_updated',
  'family_activity',
];

function isCategoryEnabled(preferences, category) {
  if (!category || !VALID_CATEGORIES.includes(category)) return true;
  if (!preferences) return true;
  return preferences[category] !== false;
}

// ---------------------------------------------------------------------------
// sendPushNotification
// ---------------------------------------------------------------------------

/**
 * Send a push notification to one or more device tokens.
 *
 * @param {string[]} deviceTokens - APNs device tokens
 * @param {object}   opts
 * @param {string}   opts.title   - Alert title
 * @param {string}   opts.body    - Alert body
 * @param {object}   [opts.data]  - Custom payload data
 * @param {number}   [opts.badge] - Badge count
 * @param {string}   [opts.sound] - Sound name (default: 'default')
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendPushNotification(deviceTokens, { title, body, data, badge, sound } = {}) {
  if (!configured || !provider) {
    return { sent: 0, failed: 0 };
  }

  if (!deviceTokens || deviceTokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const notification = new apn.Notification();
  notification.alert = { title, body };
  notification.topic = APN_BUNDLE_ID;
  notification.sound = sound || 'default';

  if (badge !== undefined) {
    notification.badge = badge;
  }

  if (data) {
    notification.payload = data;
  }

  try {
    const result = await provider.send(notification, deviceTokens);
    const sent = result.sent ? result.sent.length : 0;
    const failed = result.failed ? result.failed.length : 0;

    if (failed > 0) {
      for (const failure of result.failed) {
        console.error('[push] Delivery failed for token', failure.device, '—', failure.status, failure.response);
      }
    }

    return { sent, failed };
  } catch (err) {
    console.error('[push] Send error:', err.message);
    return { sent: 0, failed: deviceTokens.length };
  }
}

// ---------------------------------------------------------------------------
// sendToUser
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a specific user, respecting their preferences.
 *
 * @param {string} userId
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {object} [opts.data]
 * @param {string} [opts.category] - One of VALID_CATEGORIES; skipped if user disabled it
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendToUser(userId, { title, body, data, category } = {}) {
  if (!configured) {
    return { sent: 0, failed: 0 };
  }

  try {
    const [tokens, preferences] = await Promise.all([
      db.getActiveDeviceTokens(userId),
      db.getNotificationPreferences(userId),
    ]);

    if (!tokens || tokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    if (category && !isCategoryEnabled(preferences, category)) {
      return { sent: 0, failed: 0 };
    }

    const deviceTokens = tokens.map((t) => t.token);
    return sendPushNotification(deviceTokens, { title, body, data });
  } catch (err) {
    console.error('[push] sendToUser error:', err.message);
    return { sent: 0, failed: 0 };
  }
}

// ---------------------------------------------------------------------------
// sendToHousehold
// ---------------------------------------------------------------------------

/**
 * Send a push notification to all household members except the sender,
 * respecting each member's notification preferences.
 *
 * @param {string}  householdId
 * @param {string}  excludeUserId - User ID to exclude (typically the sender)
 * @param {object}  opts
 * @param {string}  opts.title
 * @param {string}  opts.body
 * @param {object}  [opts.data]
 * @param {string}  [opts.category]
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendToHousehold(householdId, excludeUserId, { title, body, data, category } = {}) {
  if (!configured) {
    return { sent: 0, failed: 0 };
  }

  try {
    const allTokens = await db.getHouseholdDeviceTokens(householdId, excludeUserId);

    if (!allTokens || allTokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    // Group tokens by user so we can check each user's preferences once
    const tokensByUser = new Map();
    for (const t of allTokens) {
      if (!tokensByUser.has(t.user_id)) {
        tokensByUser.set(t.user_id, []);
      }
      tokensByUser.get(t.user_id).push(t.token);
    }

    // Filter out users who have disabled this category
    const eligibleTokens = [];

    if (category && VALID_CATEGORIES.includes(category)) {
      const userIds = Array.from(tokensByUser.keys());
      const prefChecks = await Promise.all(
        userIds.map((uid) => db.getNotificationPreferences(uid))
      );

      for (let i = 0; i < userIds.length; i++) {
        if (isCategoryEnabled(prefChecks[i], category)) {
          eligibleTokens.push(...tokensByUser.get(userIds[i]));
        }
      }
    } else {
      for (const tokens of tokensByUser.values()) {
        eligibleTokens.push(...tokens);
      }
    }

    if (eligibleTokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    return sendPushNotification(eligibleTokens, { title, body, data });
  } catch (err) {
    console.error('[push] sendToHousehold error:', err.message);
    return { sent: 0, failed: 0 };
  }
}

module.exports = {
  sendPushNotification,
  sendToUser,
  sendToHousehold,
  isConfigured: () => configured,
};
