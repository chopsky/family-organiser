const db = require('../db/queries');

// Keys whose values are secrets/credentials and must never land in the audit
// log. NB: this deliberately does NOT match "code" - promo/redeem codes are
// meant to be auditable (knowing which code an admin minted is the point).
const SECRET_KEY = /pass(word)?|token|secret|authorization|\bhash\b|\botp\b|\bpin\b|api[_-]?key|private/i;
const MAX_STRING = 500;

// Redact a request body for storage: strip secret-ish values, truncate long
// strings, and bound recursion so a pathological payload can't blow up.
function redact(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

// Express middleware for the platform-admin router. Records every SUCCESSFUL
// mutating request (non-GET, 2xx) after the response finishes, so it never
// blocks or fails the request. Reads only - failures are swallowed (logged),
// because auditing must not break admin operations.
function adminAudit(req, res, next) {
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length
      ? redact(req.body)
      : null;
    const params = req.params && Object.keys(req.params).length ? req.params : null;
    db.recordAdminAction({
      actor_user_id: req.user?.id || null,
      actor_name: req.user?.name || null,
      method,
      // baseUrl ('/api/admin') + the route pattern ('/users/:id'), falling back
      // to the concrete path - gives a stable, low-cardinality action label.
      path: `${req.baseUrl || ''}${req.route?.path || req.path}`,
      status_code: res.statusCode,
      target_id: req.params?.id || req.params?.userId || null,
      params,
      body,
      ip: req.ip || null,
    }).catch((e) => console.error('[admin-audit] record failed:', e.message));
  });

  next();
}

module.exports = { adminAudit, redact };
