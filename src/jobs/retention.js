/**
 * Data retention cleanup job.
 *
 * Runs daily at 04:00 UTC (scheduled by src/jobs/scheduler.js) to delete
 * rows past their documented retention window. This is the code-side
 * implementation of the commitments in /privacy Section 8 "Data retention".
 *
 * What this removes, and why:
 *   - whatsapp_message_log, ai_usage_log: 90 days. Operational logs only —
 *     we use them for debugging and anomaly detection during active
 *     investigation windows; beyond 90 days they stop being useful and
 *     start being an unnecessary privacy tail.
 *   - Expired auth tokens (email verification, password reset, whatsapp
 *     verification codes, refresh tokens): once expired they're useless.
 *     The tokens themselves are opaque hashes but tidying them removes
 *     correlatable user_id metadata.
 *
 * What this does NOT touch:
 *   - Any user content (tasks, events, shopping, notes, documents). That's
 *     only deleted when the user deletes their account or household.
 *   - Active refresh tokens. Only rows where expires_at is already past
 *     are removed.
 *
 * Idempotent. Safe to re-run — a second invocation 5 seconds later is a
 * no-op because the first one removed all the eligible rows.
 */

const { supabaseAdmin } = require('../db/client');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Delete rows from a table where `column < cutoff`. Logs the count. Errors
 * are caught and logged — one failing table mustn't block the others.
 */
async function sweep(table, column, cutoffIso, label) {
  try {
    // Use head: true + count to get the delete count without pulling rows
    // back over the wire. PostgREST supports it on delete via Prefer:
    // return=representation, but the JS client exposes `count` via select
    // after delete. Simpler: just run the delete and log completion.
    const { error, count } = await supabaseAdmin
      .from(table)
      .delete({ count: 'exact' })
      .lt(column, cutoffIso);
    if (error) throw error;
    if (count && count > 0) {
      console.log(`[retention] ${label}: deleted ${count} row(s) from ${table}`);
    }
    return count || 0;
  } catch (err) {
    console.error(`[retention] ${label} failed on ${table}:`, err.message || err);
    return 0;
  }
}

async function runRetentionCleanup() {
  const now = Date.now();
  const ninetyDaysAgo = new Date(now - 90 * MS_PER_DAY).toISOString();
  const nowIso = new Date(now).toISOString();

  console.log('[retention] Starting daily cleanup…');

  // Activity logs past 90 days.
  const [waLogged, aiLogged] = await Promise.all([
    sweep('whatsapp_message_log', 'created_at', ninetyDaysAgo, 'WhatsApp log 90d'),
    sweep('ai_usage_log',         'created_at', ninetyDaysAgo, 'AI usage log 90d'),
  ]);

  // Expired auth-flow tokens (all of these store an expires_at column).
  const [email, password, whatsapp, refresh] = await Promise.all([
    sweep('email_verification_tokens', 'expires_at', nowIso, 'expired email tokens'),
    sweep('password_reset_tokens',     'expires_at', nowIso, 'expired password reset tokens'),
    sweep('whatsapp_verification_codes','expires_at', nowIso, 'expired WhatsApp codes'),
    sweep('refresh_tokens',            'expires_at', nowIso, 'expired refresh tokens'),
  ]);

  const total = waLogged + aiLogged + email + password + whatsapp + refresh;
  console.log(`[retention] Daily cleanup complete — ${total} row(s) removed in total.`);
  return total;
}

module.exports = { runRetentionCleanup };
