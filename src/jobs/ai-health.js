/**
 * AI provider health monitoring.
 *
 * Runs hourly. Looks at the last hour of ai_usage_log entries and alerts
 * the operator if either:
 *
 *   1. Gemini is being SKIPPED — most calls are landing on Claude as
 *      primary (is_failover=false), suggesting GEMINI_API_KEY is unset
 *      or misnamed in the environment. This is the failure mode that bit
 *      us in late April: Gemini went dark for ~6 days unnoticed because
 *      Claude silently absorbed the load.
 *
 *   2. Gemini is FAILING — Gemini is being attempted but throwing on
 *      most calls (auth, quota, model-not-found, etc.). The classifier
 *      still works because callWithFailover catches and falls through to
 *      Claude, but it's slower and more expensive than it should be.
 *
 * Either condition triggers a single email per day (debounced via
 * scheduler_locks) so a multi-day outage doesn't spam the inbox.
 *
 * Email recipient: ADMIN_ALERT_EMAIL, falling back to SUPPORT_EMAIL.
 * If neither is configured the alert is logged-only — that's intentional;
 * the cron should never crash the API just because Postmark is down.
 */

const { supabaseAdmin: supabase } = require('../db/client');
const db = require('../db/queries');
const email = require('../services/email');

// Thresholds — picked to be loud enough to catch real problems without
// firing on quiet hours. If hourly volume is below MIN_VOLUME we don't
// have enough signal to draw any conclusions (e.g. dead-of-night).
const MIN_VOLUME = 5;
const SKIP_RATE_THRESHOLD = 0.5;
const FAILURE_RATE_THRESHOLD = 0.5;

async function checkAiHealth() {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await supabase
      .from('ai_usage_log')
      .select('provider, is_failover, error')
      .gte('created_at', since);

    if (error) {
      console.error('[ai-health] Query failed:', error.message);
      return;
    }

    const total = rows.length;
    if (total < MIN_VOLUME) {
      // Not enough volume to draw conclusions — quiet hour, skip.
      return;
    }

    // Signal 1: Gemini being skipped entirely (Claude is primary, is_failover=false)
    const claudePrimaryCount = rows.filter(
      (r) => r.provider === 'claude' && r.is_failover === false
    ).length;
    const skipRate = claudePrimaryCount / total;

    // Signal 2: Gemini being attempted but failing
    const geminiAttempts = rows.filter((r) => r.provider === 'gemini').length;
    const geminiErrors = rows.filter((r) => r.provider === 'gemini' && r.error).length;
    const failureRate = geminiAttempts >= MIN_VOLUME ? geminiErrors / geminiAttempts : 0;

    let condition = null;
    let body = null;

    if (skipRate >= SKIP_RATE_THRESHOLD) {
      condition = 'gemini-skipped';
      body = [
        `Gemini is being skipped on most AI calls — over the last hour, ${claudePrimaryCount} of ${total} calls (${Math.round(skipRate * 100)}%) went to Claude as primary (is_failover=false).`,
        ``,
        `This usually means <code>GEMINI_API_KEY</code> is missing or misnamed in the Railway production environment. Check Railway → API service → Variables. Confirm a key exists and is non-empty.`,
        ``,
        `Until this is fixed: classifier and chat are still working (Claude is handling everything) but at higher cost and outside the documented "primary AI" claim in the Privacy Policy. Earlier this month this exact failure mode went unnoticed for 6 days.`,
      ].join('<br>');
    } else if (failureRate >= FAILURE_RATE_THRESHOLD) {
      condition = 'gemini-failing';
      // Surface a sample error so the recipient can triage without digging into logs.
      const sampleError = rows.find((r) => r.provider === 'gemini' && r.error)?.error || 'unknown';
      body = [
        `Gemini is failing on most calls — over the last hour, ${geminiErrors} of ${geminiAttempts} Gemini calls (${Math.round(failureRate * 100)}%) errored.`,
        ``,
        `Sample error: <code>${escapeHtml(sampleError)}</code>`,
        ``,
        `Failover to Claude is working so the classifier still functions, but check the Gemini API key, quota, and model identifier (<code>gemini-2.5-flash</code>) in Railway env. If quota: <a href="https://console.cloud.google.com/billing">https://console.cloud.google.com/billing</a>.`,
      ].join('<br>');
    }

    if (!condition) return;

    // Debounce: at most one email per condition per day.
    const today = new Date().toISOString().split('T')[0];
    const lockKey = `ai-health-alert:${condition}`;
    const acquired = await db.acquireSchedulerLock(lockKey, today);
    if (!acquired) {
      console.log(`[ai-health] Condition "${condition}" detected but alert already sent today; skipping.`);
      return;
    }

    const subject =
      condition === 'gemini-skipped'
        ? 'Gemini API key may be unset — Claude is doing all AI calls'
        : 'Gemini failing on most calls — check quota or API key';

    await email.sendAdminAlert(subject, body);
    console.log(`[ai-health] Sent admin alert: ${condition}`);
  } catch (err) {
    // Never crash the cron loop — log and move on.
    console.error('[ai-health] checkAiHealth failed:', err.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { checkAiHealth };
