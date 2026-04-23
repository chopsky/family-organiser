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
 *   - deletion_audit_log IP / user-agent columns older than 90 days.
 *     The audit row itself is kept (for 6-year dispute window) but the
 *     personal-data fields are nulled — UK GDPR data-minimisation (Art
 *     5(1)(c)). Matches the same retention we apply to refresh_tokens.
 *
 * Household-level cleanups (Phase 8 / spec §9):
 *   - runHouseholdRetentionCleanup — households inactive >12 months get
 *     permanently deleted. The `inactive_since` column is set by the
 *     trial-expiry middleware and the Stripe cancel webhook; cleared on
 *     resubscribe. See src/middleware/subscriptionStatus.js and
 *     src/routes/stripe-webhook.js.
 *   - runOrphanHouseholdCleanup — households that no one can log in to
 *     (zero members of member_type='account') older than 30 days get
 *     deleted. These accumulate from abandoned signups and admins
 *     leaving dependent-only households.
 *
 * What this does NOT touch:
 *   - Active households or recent account data.
 *   - Active refresh tokens. Only rows where expires_at is already past
 *     are removed.
 *
 * Idempotent. Safe to re-run — a second invocation 5 seconds later is a
 * no-op because the first one removed all the eligible rows.
 */

const { supabaseAdmin } = require('../db/client');
const db = require('../db/queries');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Household retention thresholds. Pulled to constants so tests can
// monkeypatch the window if needed, and so the numbers are in one place.
const HOUSEHOLD_INACTIVE_RETENTION_DAYS = 365;   // 12 months — spec §9
const ORPHAN_HOUSEHOLD_MIN_AGE_DAYS = 30;        // don't nuke brand-new signups mid-onboarding
const AUDIT_LOG_IP_RETENTION_DAYS = 90;          // IP / user-agent fields only, not the row itself

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

/**
 * Null out IP address + user-agent on audit-log rows older than the
 * retention window. The row itself stays for the full 6-year dispute
 * window (set in docs/gdpr-copy.md) — only the personal-data fields are
 * scrubbed so we retain the "yes, this deletion happened on this date"
 * evidence without holding IP data longer than necessary.
 */
async function nullifyOldAuditLogIPs(cutoffIso) {
  try {
    const { error, count } = await supabaseAdmin
      .from('deletion_audit_log')
      .update({ ip_address: null, user_agent: null }, { count: 'exact' })
      .lt('deleted_at', cutoffIso)
      .not('ip_address', 'is', null); // don't bother UPDATEing already-null rows
    if (error) throw error;
    if (count && count > 0) {
      console.log(`[retention] audit-log IP scrub 90d: nulled IP/UA on ${count} row(s)`);
    }
    return count || 0;
  } catch (err) {
    console.error('[retention] audit-log IP scrub failed:', err.message || err);
    return 0;
  }
}

/**
 * Delete households inactive for >12 months. `inactive_since` is set by
 * the trial-expiry middleware and Stripe cancel webhook, and cleared on
 * resubscribe, so this query picks up only households that have been
 * continuously inactive for the full window.
 *
 * Each deletion goes through db.deleteHouseholdCascade (a plpgsql
 * function with a 5-minute statement timeout — handles the biggest
 * households without timing out). We iterate one at a time rather than
 * firing a bulk DELETE to keep memory pressure predictable and let
 * individual failures not block the batch.
 *
 * Logs each deletion to deletion_audit_log with a system-deletion
 * marker so the 6-year audit window still covers retention-driven
 * removals — a regulator or upset user asking "when was my household
 * deleted?" gets a truthful answer.
 */
async function runHouseholdRetentionCleanup() {
  const cutoff = new Date(Date.now() - HOUSEHOLD_INACTIVE_RETENTION_DAYS * MS_PER_DAY).toISOString();
  let matched = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('households')
      .select('id, name')
      .not('inactive_since', 'is', null)
      .lt('inactive_since', cutoff);
    if (error) throw error;
    matched = data || [];
  } catch (err) {
    console.error('[retention] household-retention query failed:', err.message || err);
    return 0;
  }

  if (matched.length === 0) {
    return 0;
  }
  console.log(`[retention] ${matched.length} household(s) past ${HOUSEHOLD_INACTIVE_RETENTION_DAYS}-day inactive window — deleting`);

  let deleted = 0;
  for (const h of matched) {
    try {
      // Write the audit marker BEFORE the cascade so the row is the last
      // evidence of the household's existence. Best-effort — logging
      // failure doesn't block the deletion (right-to-erasure trumps
      // our audit habit). We use deletion_mode='household_deleted' +
      // user_id/user_email=null to distinguish system deletions from
      // user-initiated ones without touching the existing CHECK
      // constraint. If the `user_id NOT NULL` constraint bites, the
      // insert throws, we log, and carry on — the DB deletion still
      // happens below.
      try {
        await supabaseAdmin.from('deletion_audit_log').insert({
          user_id: null,
          user_email: null,
          household_id: h.id,
          household_name: h.name,
          deletion_mode: 'household_deleted',
          stripe_cancelled: false,
          // ip/user_agent intentionally null — system-initiated.
        });
      } catch (auditErr) {
        console.warn(`[retention] audit-log insert failed for household ${h.id} (carrying on):`, auditErr.message || auditErr);
      }

      await db.deleteHouseholdCascade(h.id);
      deleted += 1;
      console.log(`[retention] Deleted inactive household ${h.id} ("${h.name}")`);
    } catch (err) {
      console.error(`[retention] Failed to delete household ${h.id} ("${h.name}"):`, err.message || err);
      // Continue with the next household.
    }
  }
  console.log(`[retention] household-retention: deleted ${deleted}/${matched.length} household(s)`);
  return deleted;
}

/**
 * Delete orphan households — households where nobody can log in because
 * there are no members of member_type='account'. This covers:
 *   • Abandoned signups where the user created a household but never
 *     came back (no sole-admin to trigger the normal cascade).
 *   • Sole admins who deleted themselves leaving only dependents.
 *   • Manual admin cleanup that left a household empty of accounts.
 *
 * Guardrails:
 *   • Minimum age of 30 days — don't nuke a household that's in the
 *     middle of a multi-step onboarding flow (unlikely to leave zero
 *     account members, but belt-and-braces).
 *   • We never run this on `is_internal=true` households. Defensive:
 *     if your own dev account ever ends up in a weird state, we don't
 *     want the cron to sweep it up.
 */
async function runOrphanHouseholdCleanup() {
  const ageCutoff = new Date(Date.now() - ORPHAN_HOUSEHOLD_MIN_AGE_DAYS * MS_PER_DAY).toISOString();

  // Strategy: fetch candidate households (older than cutoff, not
  // internal), then for each one count account-type users. Zero = orphan.
  // We could push this into a single SQL query via a custom RPC, but
  // the volume is tiny (new deploys will have 0 orphans; mature deploys
  // a few dozen a month) and the two-step approach is easier to debug.
  let candidates = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('households')
      .select('id, name, created_at')
      .lt('created_at', ageCutoff)
      .or('is_internal.is.null,is_internal.eq.false');
    if (error) throw error;
    candidates = data || [];
  } catch (err) {
    console.error('[retention] orphan query failed:', err.message || err);
    return 0;
  }

  if (candidates.length === 0) return 0;

  let deleted = 0;
  for (const h of candidates) {
    try {
      // Count account-type members. head:true avoids pulling the rows back.
      const { count, error: countErr } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', h.id)
        .eq('member_type', 'account');
      if (countErr) throw countErr;
      if ((count || 0) > 0) continue; // not orphan — skip

      // Audit row before the cascade (same rationale as retention cleanup).
      try {
        await supabaseAdmin.from('deletion_audit_log').insert({
          user_id: null,
          user_email: null,
          household_id: h.id,
          household_name: h.name,
          deletion_mode: 'household_deleted',
          stripe_cancelled: false,
        });
      } catch (auditErr) {
        console.warn(`[retention/orphan] audit-log insert failed for household ${h.id}:`, auditErr.message || auditErr);
      }

      await db.deleteHouseholdCascade(h.id);
      deleted += 1;
      console.log(`[retention] Deleted orphan household ${h.id} ("${h.name}") — no account-type members`);
    } catch (err) {
      console.error(`[retention] Orphan check/delete failed for ${h.id}:`, err.message || err);
    }
  }
  if (deleted > 0) {
    console.log(`[retention] orphan cleanup: deleted ${deleted} household(s)`);
  }
  return deleted;
}

async function runRetentionCleanup() {
  const now = Date.now();
  const ninetyDaysAgo = new Date(now - AUDIT_LOG_IP_RETENTION_DAYS * MS_PER_DAY).toISOString();
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

  // GDPR data-minimisation on audit-log rows (not the rows themselves —
  // only the IP + user-agent columns, which stop being useful for fraud
  // investigation long before the 6-year dispute window closes).
  const ipScrub = await nullifyOldAuditLogIPs(ninetyDaysAgo);

  // Household-level cleanups — these cascade a lot of data so run them
  // sequentially (not via Promise.all) to spread the DB load.
  const retentionDeleted = await runHouseholdRetentionCleanup();
  const orphanDeleted    = await runOrphanHouseholdCleanup();

  const totalRowDeletes = waLogged + aiLogged + email + password + whatsapp + refresh;
  console.log(
    `[retention] Daily cleanup complete — ${totalRowDeletes} row(s) removed, ` +
    `${ipScrub} audit IP(s) scrubbed, ${retentionDeleted} inactive household(s) ` +
    `deleted, ${orphanDeleted} orphan household(s) deleted.`
  );
  return { totalRowDeletes, ipScrub, retentionDeleted, orphanDeleted };
}

module.exports = {
  runRetentionCleanup,
  // Exposed for tests and one-off manual triggers from the admin console.
  runHouseholdRetentionCleanup,
  runOrphanHouseholdCleanup,
  nullifyOldAuditLogIPs,
  _constants: { HOUSEHOLD_INACTIVE_RETENTION_DAYS, ORPHAN_HOUSEHOLD_MIN_AGE_DAYS, AUDIT_LOG_IP_RETENTION_DAYS },
};
