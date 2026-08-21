/**
 * How long a new household's free trial runs.
 *
 * The trial moved from 30 days to 14 (founder call 2026-08-21: at 30 days
 * the decision lands a month after the moment of need, often mid-holiday
 * when the app is quietest; 14 days is two full school weeks and decides
 * while term is still running).
 *
 * The length is version-aware ON PURPOSE. The promise a user reads lives
 * in the app binary they installed - "Free for 30 days" is baked into
 * every build up to and including 1.12.0 and can never be recalled. So
 * the server honours whatever the asking client actually promised:
 *
 *   web, and native builds from NEW_COPY_MIN_VERSION on  -> 14 days
 *   older native builds (their UI still says 30 days)    -> 30 days
 *
 * A native client with no version header gets the LONGER trial: the
 * header resolves asynchronously at app start (see web/src/lib/api.js),
 * so a fast signup can race it, and over-delivering is the only safe way
 * to be wrong. As users update, they cross the threshold on their own -
 * no migration, no cutover date, nothing to remember later.
 */

const TRIAL_DAYS = 14;
const LEGACY_TRIAL_DAYS = 30;

// The first native build whose bundled copy says 14 days. 1.12.0 was
// already in App Store review when the trial changed, so it keeps 30.
const NEW_COPY_MIN_VERSION = [1, 13, 0];

/** "1.12.0 (30)" / "1.13.0" -> [1,12,0]. Null when unparseable. */
function parseVersion(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

function gte(a, b) {
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
}

/**
 * Trial length in days for the client making this request.
 * @param {object} req - Express request (headers only; safe to pass null).
 */
function trialDaysForRequest(req) {
  const platform = String(req?.get?.('x-client-platform') || '').toLowerCase();
  const isNative = platform === 'ios' || platform === 'android';
  if (!isNative) return TRIAL_DAYS; // web always ships current copy

  const version = parseVersion(req?.get?.('x-app-version'));
  if (!version) return LEGACY_TRIAL_DAYS; // unknown build - honour the bigger promise
  return gte(version, NEW_COPY_MIN_VERSION) ? TRIAL_DAYS : LEGACY_TRIAL_DAYS;
}

/** ISO timestamp for when a trial starting now should end. */
function trialEndsAtFor(days, now = Date.now()) {
  return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  TRIAL_DAYS,
  LEGACY_TRIAL_DAYS,
  NEW_COPY_MIN_VERSION,
  parseVersion,
  trialDaysForRequest,
  trialEndsAtFor,
};
