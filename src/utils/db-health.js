/**
 * Database reachability probe.
 *
 * Shared by the /health/db readiness endpoint and the db-health cron so both
 * report on exactly the same check - if they diverged, an alert email and the
 * endpoint an operator curls could disagree during an incident, which is the
 * worst possible time for that.
 *
 * Written after the 2026-07-29 outage: Supabase's Postgres was unreachable for
 * ~35 minutes (PostgREST returning PGRST002 "Could not query the database for
 * the schema cache") while /health returned {"status":"ok"} throughout, because
 * it only ever read environment variables. Nothing alerted; a user noticed.
 *
 * Never throws - always resolves to a result object. A health check that can
 * throw is a health check that can take down the thing reporting health.
 */

const { supabaseAdmin } = require('../db/client');

// Deliberately short. A probe that hangs is indistinguishable from a probe
// that fails, and hanging is worse: it stacks up cron runs and stalls the
// readiness endpoint. During the 2026-07-29 outage PostgREST answered its
// 503 in ~1.7s, so 5s leaves generous headroom over a real failure response
// while still failing fast on a genuine hang.
const PROBE_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Database probe exceeded ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Probe the database with a cheap indexed read.
 *
 * @returns {Promise<{ok: boolean, latencyMs: number, code: string|null, message: string|null}>}
 */
async function checkDatabase() {
  const started = Date.now();
  try {
    // Single-row select on an indexed PK. PGRST116 ("no rows") counts as
    // SUCCESS - an empty table still proves we reached Postgres and it
    // answered us, which is the only thing this probe is asking.
    const { error } = await withTimeout(
      supabaseAdmin.from('households').select('id').limit(1),
      PROBE_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - started;

    if (error && error.code !== 'PGRST116') {
      return {
        ok: false,
        latencyMs,
        code: error.code || null,
        message: error.message || 'Unknown database error',
      };
    }
    return { ok: true, latencyMs, code: null, message: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      code: err.code || 'EXCEPTION',
      message: err.message || String(err),
    };
  }
}

module.exports = { checkDatabase, PROBE_TIMEOUT_MS };
