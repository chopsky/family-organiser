/**
 * Push notifications - APNs for iOS, FCM (HTTP v1) for Android, both using
 * Node built-ins only (no third-party deps): APNs over http2 with an ES256
 * JWT, FCM over fetch with an RS256 service-account JWT exchanged for an
 * OAuth access token. Each device_tokens row carries `platform`
 * ('ios' | 'android') and is routed to its provider.
 *
 * Fire-and-forget: errors are logged but never block the caller.
 * An unconfigured provider (missing env vars) makes ITS sends silent
 * no-ops - the other platform keeps working.
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

// APNs has two isolated environments. A device token only works against the
// environment whose entitlement the app was built with: Xcode debug builds →
// sandbox; TestFlight + App Store builds → production. Sending a token to the
// wrong host fails with 403 BadEnvironmentKeyInToken / BadDeviceToken. Because
// the device_tokens table inevitably holds a MIX (dev builds while testing,
// production builds in the wild) we deliver each token to whichever
// environment it actually belongs to: try the primary, and on an
// environment-mismatch retry the other. APN_PRODUCTION only decides which we
// attempt FIRST (set it true once you're testing TestFlight/App Store builds
// to avoid a wasted sandbox attempt).
const APN_HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};
const PRIMARY_ENV = APN_PRODUCTION ? 'production' : 'sandbox';
const FALLBACK_ENV = PRIMARY_ENV === 'production' ? 'sandbox' : 'production';

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
    console.log(`[push] APNs configured (trying ${PRIMARY_ENV} first, ${FALLBACK_ENV} on environment mismatch)`);
  } catch (err) {
    console.warn('[push] Failed to load APNs key:', err.message);
  }
} else {
  console.warn('[push] APNs not configured - need APN_KEY_ID, APN_TEAM_ID, and APN_KEY (or APN_KEY_PATH). iOS push disabled.');
}

// FCM: the Firebase service-account JSON, pasted whole into one env var.
let fcm = null;
let fcmConfigured = false;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.project_id && sa.client_email && sa.private_key) {
      // Real JSON carries actual newlines in private_key; the replace also
      // tolerates a doubly-escaped paste (same trick as APN_KEY above).
      fcm = { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') };
      fcmConfigured = true;
      console.log(`[push] FCM configured (project ${fcm.projectId})`);
    } else {
      console.warn('[push] FIREBASE_SERVICE_ACCOUNT lacks project_id/client_email/private_key - Android push disabled.');
    }
  } catch (err) {
    console.warn('[push] FIREBASE_SERVICE_ACCOUNT is not valid JSON - Android push disabled:', err.message);
  }
} else {
  console.warn('[push] FCM not configured (no FIREBASE_SERVICE_ACCOUNT) - Android push disabled.');
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

// One HTTP/2 session per APNs host (production + sandbox), opened lazily.
const h2Sessions = {};      // host → ClientHttp2Session
const h2SessionTimers = {}; // host → idle-close timer

function getH2Session(host) {
  const existing = h2Sessions[host];
  if (existing && !existing.closed && !existing.destroyed) {
    return existing;
  }
  const session = http2.connect(host);
  session.on('error', (err) => {
    console.error('[push] HTTP/2 session error:', err.message);
    if (h2Sessions[host] === session) h2Sessions[host] = null;
  });
  session.on('close', () => { if (h2Sessions[host] === session) h2Sessions[host] = null; });
  h2Sessions[host] = session;
  // Close idle sessions after 5 minutes
  clearTimeout(h2SessionTimers[host]);
  h2SessionTimers[host] = setTimeout(() => {
    const s = h2Sessions[host];
    if (s) { s.close(); h2Sessions[host] = null; }
  }, 5 * 60 * 1000);
  if (h2SessionTimers[host].unref) h2SessionTimers[host].unref();
  return session;
}

// ---------------------------------------------------------------------------
// Send a single push notification to one device
// ---------------------------------------------------------------------------

function sendOne(deviceToken, payload, host) {
  return new Promise((resolve) => {
    try {
      const session = getH2Session(host);
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
          // Logging happens in deliver() once retries are exhausted, so an
          // environment-mismatch that succeeds on retry doesn't spam errors.
          resolve({ success: false, status, reason: responseBody });
        }
      });
      req.on('error', (err) => {
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
// deliver - send one token to the correct APNs environment
// ---------------------------------------------------------------------------

// Reasons that mean "right token, wrong environment" - retrying the other
// host fixes it. BadDeviceToken is included because token-auth environment
// mismatches frequently surface as BadDeviceToken rather than the explicit
// environment reason.
function isEnvironmentMismatch(reason) {
  return /BadEnvironmentKeyInToken|BadCertificateEnvironment|BadDeviceToken/i.test(reason || '');
}

// Remember which environment a token last delivered to, so repeat sends in the
// same process skip the wasted first attempt. Cleared when a token is pruned.
const tokenEnvCache = new Map(); // token → 'production' | 'sandbox'

/**
 * Deliver a single notification to the environment the token belongs to.
 * Tries the primary environment (or the cached one), and on an
 * environment-mismatch retries the other. Prunes tokens APNs reports as
 * Unregistered (410 - app deleted). Never throws.
 */
async function deliver(deviceToken, payload) {
  const known = tokenEnvCache.get(deviceToken);
  const order = known
    ? [known, known === 'production' ? 'sandbox' : 'production']
    : [PRIMARY_ENV, FALLBACK_ENV];

  let last = null;
  for (let i = 0; i < order.length; i++) {
    const env = order[i];
    // eslint-disable-next-line no-await-in-loop
    const res = await sendOne(deviceToken, payload, APN_HOSTS[env]);
    if (res.success) {
      tokenEnvCache.set(deviceToken, env);
      return res;
    }
    last = res;
    // Only the first attempt is worth retrying, and only on an env mismatch -
    // other errors (PayloadTooLarge, Unregistered, etc.) won't change.
    if (i === 0 && !isEnvironmentMismatch(res.reason)) break;
  }

  // Prune confirmed-dead tokens so they stop failing on every send (and stop
  // inflating the user's device count). Two cases, both terminal here:
  //   • 410 Unregistered  - the app was deleted from the device.
  //   • BadDeviceToken    - stale token from a past install / rebuild / OS
  //     token rotation. Safe to prune because deliver() already retried BOTH
  //     environments above, so this token is invalid in production AND
  //     sandbox - not a recoverable environment mismatch.
  // NOTE: we deliberately do NOT prune on DeviceTokenNotForTopic or other
  // reasons, which would indicate a server-side misconfig affecting every
  // token rather than a dead device.
  const isDead = last && (
    last.status === 410
    || /Unregistered|BadDeviceToken/i.test(last.reason || '')
  );
  if (isDead) {
    try {
      await db.unregisterDeviceToken(deviceToken);
      tokenEnvCache.delete(deviceToken);
      console.log('[push] Pruned dead token', `${deviceToken.slice(0, 8)}...`, `(${last.status} ${last.reason})`);
    } catch { /* best-effort */ }
  } else if (last && !last.success) {
    console.error('[push] APNs failed for token', `${deviceToken.slice(0, 8)}...`, '- status:', last.status, last.reason);
  }
  return last || { success: false };
}

/**
 * Diagnostic variant of deliver(): reports which environment a token
 * succeeded on (or both failures), and NEVER prunes - so a self-test run
 * can't deactivate a token we're trying to inspect. For the admin push
 * self-test only. Returns { success, env, status, reason }.
 */
async function deliverDiagnostic(deviceToken, payload) {
  if (!configured) return { success: false, reason: 'APNs not configured on the server', attempts: [] };
  const order = [PRIMARY_ENV, FALLBACK_ENV];
  const attempts = [];
  let last = null;
  for (let i = 0; i < order.length; i++) {
    const env = order[i];
    // eslint-disable-next-line no-await-in-loop
    const res = await sendOne(deviceToken, payload, APN_HOSTS[env]);
    attempts.push({
      env,
      ok: !!res.success,
      status: res.success ? 200 : (res.status || null),
      reason: res.reason || null,
    });
    if (res.success) return { success: true, env, status: 200, attempts };
    last = { success: false, env, status: res.status, reason: res.reason };
    if (i === 0 && !isEnvironmentMismatch(res.reason)) break;
  }
  return { ...(last || { success: false }), attempts };
}

// ---------------------------------------------------------------------------
// FCM (Android) - OAuth token + HTTP v1 delivery
// ---------------------------------------------------------------------------

// Google OAuth access token from the service account: sign an RS256 JWT and
// exchange it. Cached ~50 min (Google issues 60-min tokens).
let cachedFcmToken = null;
let cachedFcmTokenTime = 0;
const FCM_TOKEN_LIFETIME = 50 * 60 * 1000;

async function getFcmAccessToken() {
  const now = Date.now();
  if (cachedFcmToken && (now - cachedFcmTokenTime) < FCM_TOKEN_LIFETIME) {
    return cachedFcmToken;
  }
  const iat = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: fcm.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600,
  })).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(fcm.privateKey).toString('base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${signingInput}.${signature}`,
  });
  if (!res.ok) throw new Error(`FCM OAuth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  cachedFcmToken = json.access_token;
  cachedFcmTokenTime = now;
  return cachedFcmToken;
}

/**
 * Deliver one notification to one Android token via FCM HTTP v1. Prunes
 * tokens Google reports as UNREGISTERED (app uninstalled / token rotated),
 * mirroring the APNs 410 handling. Never throws.
 */
async function deliverFcm(deviceToken, { title, body, data, badge } = {}) {
  try {
    const accessToken = await getFcmAccessToken();
    const message = {
      token: deviceToken,
      notification: { title, body },
      android: {
        priority: 'HIGH',
        notification: {
          sound: 'default',
          ...(badge !== undefined ? { notification_count: badge } : {}),
        },
      },
    };
    if (data) {
      // FCM data values MUST be strings - numbers/objects are rejected.
      message.data = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
      );
    }
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (res.ok) return { success: true };
    const text = await res.text();
    if (res.status === 404 || /UNREGISTERED/.test(text)) {
      try {
        await db.unregisterDeviceToken(deviceToken);
        console.log('[push] Pruned dead FCM token', `${deviceToken.slice(0, 8)}...`);
      } catch { /* best-effort */ }
    } else {
      console.error('[push] FCM failed for token', `${deviceToken.slice(0, 8)}...`, '- status:', res.status, text.slice(0, 200));
    }
    return { success: false, status: res.status, reason: text.slice(0, 200) };
  } catch (err) {
    console.error('[push] deliverFcm error:', err.message);
    return { success: false, reason: err.message };
  }
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
  if (!deviceTokens || deviceTokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Accept bare token strings (legacy callers - assumed iOS) or
  // { token, platform } rows, and route each to its provider.
  const entries = deviceTokens.map((t) => (
    typeof t === 'string' ? { token: t, platform: 'ios' } : { token: t.token, platform: t.platform || 'ios' }
  ));
  const ios = entries.filter((e) => e.platform !== 'android');
  const android = entries.filter((e) => e.platform === 'android');
  const results = [];

  if (ios.length && configured) {
    const payload = {
      aps: {
        alert: { title, body },
        sound: sound || 'default',
      },
    };
    if (badge !== undefined) payload.aps.badge = badge;
    if (data) Object.assign(payload, data);
    results.push(...await Promise.all(ios.map((e) => deliver(e.token, payload))));
  } else if (ios.length) {
    results.push(...ios.map(() => ({ success: false, reason: 'APNs not configured' })));
  }

  if (android.length && fcmConfigured) {
    results.push(...await Promise.all(android.map((e) => deliverFcm(e.token, { title, body, data, badge }))));
  } else if (android.length) {
    results.push(...android.map(() => ({ success: false, reason: 'FCM not configured' })));
  }

  const sent = results.filter((r) => r.success).length;
  return { sent, failed: results.length - sent };
}

// ---------------------------------------------------------------------------
// sendToUser
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a specific user, respecting their preferences.
 */
async function sendToUser(userId, { title, body, data, category } = {}) {
  if (!configured && !fcmConfigured) {
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

    const deviceTokens = tokens.map((t) => ({ token: t.token, platform: t.platform || 'ios' }));
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
  if (!configured && !fcmConfigured) {
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
      tokensByUser.get(t.user_id).push({ token: t.token, platform: t.platform || 'ios' });
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

/**
 * Non-secret APNs config for the admin diagnostic. Key ID and Team ID are
 * identifiers (not secrets - they appear in entitlements/the portal); the
 * private .p8 is never exposed. Lets an operator compare what the server is
 * configured with against Apple Developer → Keys / Membership.
 */
function getConfigInfo() {
  return {
    configured,
    keyId: APN_KEY_ID || null,
    teamId: APN_TEAM_ID || null,
    bundleId: APN_BUNDLE_ID,
    primaryEnv: PRIMARY_ENV,
    apnProduction: APN_PRODUCTION,
    fcmConfigured,
    fcmProjectId: fcm?.projectId || null,
  };
}

module.exports = {
  sendPushNotification,
  getConfigInfo,
  sendToUser,
  sendToHousehold,
  isConfigured: () => configured,
  deliverDiagnostic,
  // Exported for unit testing the environment-retry decision.
  _isEnvironmentMismatch: isEnvironmentMismatch,
};
