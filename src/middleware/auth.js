const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Missing JWT_SECRET environment variable - refusing to start with insecure defaults');
}

// Short-lived access token - paired with a 7-day rotating refresh token
// in routes/auth.js. Active users refresh silently; inactive sessions
// expire after 7 days of no activity.
const JWT_EXPIRES_IN = '1h';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Long-lived token for the iOS Siri App Intent ("Hey Siri, add to
// Housemait"). Intents run outside the WebView with no access to the 1h
// access token, and the rotating refresh token is single-use (consuming it
// from Swift would log the app out), so Siri gets its own credential.
// Containment: scope:'siri' is rejected by requireAuth everywhere except
// routes that opt in via allowSiriScope, so a leaked token can add
// shopping items and nothing else. 180d ≈ "re-minted long before it
// expires" (the app re-mints weekly on launch).
const SIRI_TOKEN_EXPIRES_IN = '180d';

function signSiriToken(payload) {
  return jwt.sign({ ...payload, scope: 'siri' }, JWT_SECRET, { expiresIn: SIRI_TOKEN_EXPIRES_IN });
}

/**
 * Marks the request as accepting scope:'siri' tokens. Mount BEFORE
 * requireAuth on the specific routes the Siri intent is allowed to call.
 */
function allowSiriScope(req, res, next) {
  req.siriScopeAllowed = true;
  return next();
}

/**
 * Express middleware: validates Bearer JWT and attaches req.user + req.householdId.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);
  req.token = token;
  try {
    // Pin the algorithm: tokens are always signed HS256 (symmetric secret), so
    // refusing any other alg closes the algorithm-confusion / alg:none class.
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    // Scope containment: Siri tokens are long-lived, so they only work on
    // routes that explicitly opted in (see allowSiriScope above).
    if (payload.scope === 'siri' && req.siriScopeAllowed !== true) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = { id: payload.userId, name: payload.name, role: payload.role, isPlatformAdmin: payload.isPlatformAdmin || false };
    req.householdId = payload.householdId;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Household management gate. Housemait is collaborative: ANY adult member of a
 * household can manage it - add family members, schools, term dates, weekly
 * activities, and household settings. Children are never authenticated (they're
 * records, not logins), so any authenticated household member is an adult and
 * may manage. Billing/subscription is the one exception and is restricted to
 * the household owner (created_by) - enforced inline in the subscription routes.
 *
 * The name `requireAdmin` is kept (it guards the same family-management routes
 * it always did) so call sites don't churn; it now means "an authenticated
 * member of a household". Must be chained after requireAuth + requireHousehold.
 */
function requireAdmin(req, res, next) {
  if (!req.user || !req.householdId) {
    return res.status(403).json({ error: 'You must be a member of a household.' });
  }
  return next();
}

/**
 * Middleware: requires the user to belong to a household.
 * Must be chained after requireAuth. Blocks users who signed up but haven't joined/created a household yet.
 */
function requireHousehold(req, res, next) {
  if (!req.householdId) {
    return res.status(403).json({ error: 'You must join or create a household first.' });
  }
  return next();
}

/**
 * Middleware: requires the user to be a platform admin.
 * Must be chained after requireAuth.
 */
function requirePlatformAdmin(req, res, next) {
  if (!req.user.isPlatformAdmin) {
    return res.status(403).json({ error: 'Platform admin access required' });
  }
  return next();
}

module.exports = { signToken, signSiriToken, allowSiriScope, requireAuth, requireAdmin, requireHousehold, requirePlatformAdmin };
