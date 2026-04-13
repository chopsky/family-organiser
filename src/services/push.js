/**
 * Apple Push Notification service (APNs) — sends push notifications
 * to iOS devices using Node's built-in http2 module (no third-party deps).
 *
 * Fire-and-forget: errors are logged but never block the caller.
 * If APNs is not configured (missing env vars), all send functions
 * become silent no-ops so the app works fine without push.
 */

const http2 = require('http2');
const crypto = require('crypto');
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

const APN_HOST = APN_PRODUCTION
  ? 'https://api.push.apple.com'
  : 'https://api.sandbox.push.apple.com';

let signingKey = null;
let configured = false;

if (APN_KEY_ID && APN_TEAM_ID && (APN_KEY || APN_KEY_PATH)) {
  try {
    if (APN_KEY) {
      signingKey = APN_KEY.replace(/\\n/g, '\n');
    } else {
      signingKey = require('fs').readFileSync(APN_KEY_PATH, 'utf8');
    }
    configured = true;
    console.log('[push] APNs configured', APN_PRODUCTION ? '(production)' : '(sandbox)');
  } catch (err) {
    console.warn('[push] Failed to load APNs key:', err.message);
  }
} else {
  console.warn('[push] APNs not configured — need APN_KEY_ID, APN_TEAM_ID, and APN_KEY (or APN_KEY_PATH). Push notifications disabled.');
}

// ---------------------------------------------------------------------------
// JWT token generation for APNs
// ---------------------------------------------------------------------------

let cachedJwt = null;
let cachedJwtTime = 0;
const JWT_LIFETIME = 50 * 60 * 1000; // Refresh every 50 minutes (Apple allows up to 60)

function getApnsJwt() {
  const now = Date.now();
  if (cachedJwt && (now - cachedJwtTime) < JWT_LIFETIME) {
    return cachedJwt;
  }

  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: APN_KEY_ID })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: APN_TEAM_ID, iat: Math.floor(now / 1000) })).toString('base64url');
  const signingInput = `${header}.${claims}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const derSig = sign.sign(signingKey);

  // Convert DER signature to raw r||s format for ES256
  const rawSig = derToRaw(derSig);
  const signature = rawSig.toString('base64url');

  cachedJwt = `${signingInput}.${signature}`;
  cachedJwtTime = now;
  return cachedJwt;
}

/** Convert DER-encoded ECDSA signature to raw 64-byte r||s */
function derToRaw(derSig) {
  // DER: 0x30 [len] 0x02 [rLen] [r] 0x02 [sLen] [s]
  let offset = 2; // skip 0x30 and total length
  // r
  offset += 1; // skip 0x02
  const rLen = derSig[offset++];
  const r = derSig.subarray(offset, offset + rLen);
  offset += rLen;
  // s
  offset += 1; // skip 0x02
  const sLen = derSig[offset++];
  const s = derSig.subarray(offset, offset + sLen);

  const raw = Buffer.alloc(64);
  // Pad or trim r and s to 32 bytes each
  r.subarray(Math.max(0, rLen - 32)).copy(raw, 32 - Math.min(rLen, 32));
  s.subarray(Math.max(0, sLen - 32)).copy(raw, 64 - Math.min(sLen, 32));
  return raw;
}

// ---------------------------------------------------------------------------
// HTTP/2 connection management
// ---------------------------------------------------------------------------

let h2Session = null;
let h2SessionTimer = null;

function getH2Session() {
  if (h2Session && !h2Session.closed && !h2Session.destroyed) {
    return h2Session;
  }
  h2Session = http2.connect(APN_HOST);
  h2Session.on('error', (err) => {
    console.error('[push] HTTP/2 session error:', err.message);
    h2Session = null;
  });
  h2Session.on('close', () => { h2Session = null; });
  // Close idle sessions after 5 minutes
  clearTimeout(h2SessionTimer);
  h2SessionTimer = setTimeout(() => {
    if (h2Session) { h2Session.close(); h2Session = null; }
  }, 5 * 60 * 1000);
  if (h2SessionTimer.unref) h2SessionTimer.unref();
  return h2Session;
}

// ---------------------------------------------------------------------------
// Send a single push notification to one device
// ---------------------------------------------------------------------------

function sendOne(deviceToken, payload) {
  return new Promise((resolve) => {
    try {
      const session = getH2Session();
      const jwt = getApnsJwt();
      const body = JSON.stringify(payload);

      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        'authorization': `bearer ${jwt}`,
        'apns-topic': APN_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      });

      let status;
      let responseBody = '';

      req.on('response', (headers) => { status = headers[':status']; });
      req.on('data', (chunk) => { responseBody += chunk; });
      req.on('end', () => {
        if (status === 200) {
          resolve({ success: true });
        } else {
          console.error('[push] APNs error for token', deviceToken.substring(0, 8) + '...', '— status:', status, responseBody);
          resolve({ success: false, status, reason: responseBody });
        }
      });
      req.on('error', (err) => {
        console.error('[push] Request error:', err.message);
        resolve({ success: false, reason: err.message });
      });

      req.end(body);

      // Timeout after 10 seconds
      req.setTimeout(10000, () => {
        req.close();
        resolve({ success: false, reason: 'timeout' });
      });
    } catch (err) {
      console.error('[push] sendOne error:', err.message);
      resolve({ success: false, reason: err.message });
    }
  });
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
  if (!configured) {
    return { sent: 0, failed: 0 };
  }

  if (!deviceTokens || deviceTokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const payload = {
    aps: {
      alert: { title, body },
      sound: sound || 'default',
    },
  };

  if (badge !== undefined) {
    payload.aps.badge = badge;
  }

  if (data) {
    Object.assign(payload, data);
  }

  const results = await Promise.all(deviceTokens.map((t) => sendOne(t, payload)));
  const sent = results.filter((r) => r.success).length;
  const failed = results.length - sent;

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// sendToUser
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a specific user, respecting their preferences.
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
