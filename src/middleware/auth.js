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

module.exports = { signToken, requireAuth, requireAdmin, requireHousehold, requirePlatformAdmin };
