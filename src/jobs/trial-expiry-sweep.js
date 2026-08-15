/**
 * Daily sweep: flip overdue trials to 'expired'.
 *
 * Trial expiry is ENFORCED at request time by the subscriptionStatus
 * middleware (the first mutating request after trial_ends_at gets a 402
 * and flips the row), so this sweep adds no access control. What it fixes
 * is the households that never come back: their rows sit on 'trialing'
 * forever, which understates the expired cohort in admin (20 rows drifted
 * by Aug 2026) and silently skews anything keyed off subscription_status -
 * plan filters, the win-back cohort, trial-conversion metrics.
 *
 * Mirrors the middleware's transition exactly: same conditional UPDATE
 * (WHERE status='trialing') so a concurrent request-time flip can't race
 * us, same inactive_since = trial_ends_at to start the retention clock,
 * and paused trials (trial_paused_at set) are untouchable here just as
 * they are in the middleware.
 */

const { supabaseAdmin } = require('../db/client');

async function runTrialExpirySweep() {
  let overdue;
  try {
    const { data, error } = await supabaseAdmin
      .from('households')
      .select('id, trial_ends_at')
      .eq('subscription_status', 'trialing')
      .eq('is_internal', false)   // middleware never applies status logic to internal rows; neither do we
      .is('trial_paused_at', null)
      .lt('trial_ends_at', new Date().toISOString());
    if (error) throw error;
    overdue = data || [];
  } catch (err) {
    console.error('[trial-expiry-sweep] fetch failed:', err.message);
    return { flipped: 0, failed: 0, error: err.message };
  }

  let flipped = 0;
  let failed = 0;
  for (const h of overdue) {
    try {
      const { error } = await supabaseAdmin
        .from('households')
        .update({ subscription_status: 'expired', inactive_since: h.trial_ends_at })
        .eq('id', h.id)
        .eq('subscription_status', 'trialing'); // lose the race to the middleware gracefully
      if (error) throw error;
      flipped++;
    } catch (err) {
      failed++;
      console.error(`[trial-expiry-sweep] flip failed for ${h.id}:`, err.message);
    }
  }
  if (overdue.length > 0) {
    console.log(`[trial-expiry-sweep] ${flipped} trial(s) marked expired${failed ? `, ${failed} failed` : ''}`);
  }
  return { flipped, failed };
}

module.exports = { runTrialExpirySweep };
