/**
 * AI provider + bot health monitoring.
 *
 * Runs hourly. Looks at the last hour of ai_usage_log and whatsapp_message_log
 * and alerts the operator on any of:
 *
 *   1. PRIMARY FAILING - most calls are landing on a failover provider
 *      (is_failover=true). Whatever the per-feature primary is (classify is
 *      Claude-first since 2026-07-02; most other features are Gemini-first),
 *      a high failover share means the primary is erroring/unreachable and
 *      the chain is silently absorbing it — working, but slower, pricier,
 *      and one provider closer to a full outage. (This replaces the old
 *      "gemini-skipped" signal, which predated Claude-primary classify and
 *      inverted into a false alarm: Claude with is_failover=false is now the
 *      EXPECTED shape, not a missing-Gemini-key symptom.)
 *
 *   2. PROVIDER ERRORING - any single provider is throwing on most of its
 *      attempted calls (auth, quota, model-not-found). Failover keeps the
 *      product working, so this is invisible to users until the next
 *      provider in the chain has a bad hour too.
 *
 *   3. BOT USER-VISIBLE FAILURES - WhatsApp turns where the user actually
 *      received an apology (whatsapp_message_log.error set on an inbound
 *      row). This is the headline metric: every one of these is a family
 *      that asked the bot something and got "sorry" back.
 *
 * Each condition triggers at most one email per day (debounced via
 * scheduler_locks) so a multi-day outage doesn't spam the inbox.
 *
 * Email recipient: ADMIN_ALERT_EMAIL, falling back to SUPPORT_EMAIL.
 * If neither is configured the alert is logged-only - that's intentional;
 * the cron should never crash the API just because Postmark is down.
 */

const { supabaseAdmin: supabase } = require('../db/client');
const db = require('../db/queries');
const email = require('../services/email');

// Thresholds - picked to be loud enough to catch real problems without
// firing on quiet hours. If hourly volume is below MIN_VOLUME we don't
// have enough signal to draw any conclusions (e.g. dead-of-night).
const MIN_VOLUME = 5;
const FAILOVER_RATE_THRESHOLD = 0.5;
const FAILURE_RATE_THRESHOLD = 0.5;
// User-visible bot failures are individually bad, so the bar is a count,
// not a rate: three families apologised-to in an hour is an incident.
const USER_FAILURE_THRESHOLD = 3;

async function checkAiHealth() {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [{ data: rows, error }, { count: userFailures, error: waError }] = await Promise.all([
      supabase
        .from('ai_usage_log')
        .select('provider, is_failover, error')
        .gte('created_at', since),
      supabase
        .from('whatsapp_message_log')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'inbound')
        .not('error', 'is', null)
        .gte('created_at', since),
    ]);

    if (error) {
      console.error('[ai-health] Query failed:', error.message);
      return;
    }
    if (waError) console.error('[ai-health] whatsapp_message_log query failed:', waError.message);

    // ── Signal 3 first: user-visible failures don't need MIN_VOLUME — three
    //    apologies at 2am is still an incident worth waking up to. ──
    if (!waError && (userFailures || 0) >= USER_FAILURE_THRESHOLD) {
      await sendOncePerDay(
        'bot-user-failures',
        `WhatsApp bot: ${userFailures} user-visible failures in the last hour`,
        [
          `${userFailures} WhatsApp turns in the last hour ended with the user receiving an error apology (whatsapp_message_log.error set).`,
          ``,
          `Triage: Admin → AI usage → Bot health strip shows the recent failures with intents and error messages. Railway logs have the full [whatsapp-text-handler-error] blocks.`,
        ].join('<br>')
      );
    }

    const total = rows.length;
    if (total < MIN_VOLUME) {
      // Not enough provider volume to draw conclusions - quiet hour, skip.
      return;
    }

    // ── Signal 1: primary struggling — failover share of all calls ──
    const failoverCount = rows.filter((r) => r.is_failover === true).length;
    const failoverRate = failoverCount / total;
    if (failoverRate >= FAILOVER_RATE_THRESHOLD) {
      const byProvider = {};
      for (const r of rows.filter((x) => x.is_failover)) {
        byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
      }
      const landed = Object.entries(byProvider).map(([p, n]) => `${p}: ${n}`).join(', ');
      await sendOncePerDay(
        'primary-failing',
        'AI primary provider struggling - most calls are failing over',
        [
          `Over the last hour, ${failoverCount} of ${total} AI calls (${Math.round(failoverRate * 100)}%) were served by a FAILOVER provider (${landed}).`,
          ``,
          `The product is still working, but the primary for those features is erroring or unreachable — check the provider status pages and the API keys in Railway → Variables. classify's primary is Claude (<code>ANTHROPIC_API_KEY</code>); most other features are Gemini-first (<code>GEMINI_API_KEY</code>).`,
        ].join('<br>')
      );
      return; // one alert per run is enough; provider detail is in the email
    }

    // ── Signal 2: any provider erroring on most of its attempts ──
    const providers = [...new Set(rows.map((r) => r.provider))];
    for (const provider of providers) {
      const attempts = rows.filter((r) => r.provider === provider);
      if (attempts.length < MIN_VOLUME) continue;
      const errors = attempts.filter((r) => r.error);
      const failureRate = errors.length / attempts.length;
      if (failureRate >= FAILURE_RATE_THRESHOLD) {
        const sampleError = errors[0]?.error || 'unknown';
        await sendOncePerDay(
          `provider-failing:${provider}`,
          `${provider} failing on most AI calls - check quota or API key`,
          [
            `${provider} errored on ${errors.length} of ${attempts.length} calls (${Math.round(failureRate * 100)}%) in the last hour.`,
            ``,
            `Sample error: <code>${escapeHtml(sampleError)}</code>`,
            ``,
            `Failover is absorbing it so users are unaffected for now, but check the ${provider} API key, quota, and model identifier in Railway env.`,
          ].join('<br>')
        );
      }
    }
  } catch (err) {
    // Never crash the cron loop - log and move on.
    console.error('[ai-health] checkAiHealth failed:', err.message);
  }
}

// Debounce helper: at most one email per condition per day.
async function sendOncePerDay(condition, subject, body) {
  const today = new Date().toISOString().split('T')[0];
  const acquired = await db.acquireSchedulerLock(`ai-health-alert:${condition}`, today);
  if (!acquired) {
    console.log(`[ai-health] Condition "${condition}" detected but alert already sent today; skipping.`);
    return;
  }
  await email.sendAdminAlert(subject, body);
  console.log(`[ai-health] Sent admin alert: ${condition}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { checkAiHealth };
