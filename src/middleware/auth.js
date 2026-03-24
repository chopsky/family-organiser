const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = '30d';

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
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.userId, name: payload.name, role: payload.role, isPlatformAdmin: payload.isPlatformAdmin || false };
    req.householdId = payload.householdId;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware: requires the user to be an admin.
 * Must be chained after requireAuth.
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
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
