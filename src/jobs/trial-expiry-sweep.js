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
const assistantMeter = require('../services/assistant-meter');

/**
 * FREE_APP_MODE: the proactive lapse announcement (quota-ladder step 0).
 *
 * Most lapsing households are OUTSIDE the 24h WhatsApp window, where
 * free-form sends are rejected - so this rides a Meta-APPROVED utility
 * template, configured via TWILIO_TEMPLATE_LAPSE_ANNOUNCEMENT (a Twilio
 * Content SID, HX + 32 hex - founder creates it in the Content Template
 * Builder; see the spec's implementation map item 8b). Until the env var
 * is set this no-ops silently and the in-reply backstop carries the
 * announcement alone.
 *
 * Sweeps EVERY lapsed household without a free_deal_announced_at stamp -
 * which on the first night after launch is the whole expired backlog, so
 * the win-back moment needs no separate backfill. One send per household
 * (to its WhatsApp-linked members), stamped only on success.
 */
async function announceLapsedDeals() {
  const templateSid = process.env.TWILIO_TEMPLATE_LAPSE_ANNOUNCEMENT;
  if (!assistantMeter.enabled() || !templateSid) return { announced: 0 };
  const whatsapp = require('../services/whatsapp');
  let announced = 0;
  try {
    const { data, error } = await supabaseAdmin
      .from('households')
      .select('id, is_internal, complimentary_until, free_deal_announced_at, subscription_status')
      .in('subscription_status', ['expired', 'cancelled'])
      .is('free_deal_announced_at', null)
      .eq('is_internal', false)
      .limit(200);
    if (error) throw error;
    const nowMs = Date.now();
    const due = (data || []).filter(
      (h) => !(h.complimentary_until && new Date(h.complimentary_until).getTime() > nowMs)
    );
    for (const h of due) {
      try {
        const { data: members, error: mErr } = await supabaseAdmin
          .from('users')
          .select('id, whatsapp_phone, whatsapp_linked')
          .eq('household_id', h.id)
          .eq('whatsapp_linked', true);
        if (mErr) throw mErr;
        const linked = (members || []).filter((m) => m.whatsapp_phone);
        if (linked.length === 0) continue;
        // Zero-linked households stay UNSTAMPED on purpose: the app-chat
        // backstop (their only in-product announcement until the Settings
        // banner ships) still fires on their first chat reply.
        for (const m of linked) {
          await whatsapp.sendTemplate(m.whatsapp_phone, templateSid, {});
        }
        const { error: uErr } = await supabaseAdmin
          .from('households')
          .update({ free_deal_announced_at: new Date().toISOString() })
          .eq('id', h.id);
        if (uErr) throw uErr;
        announced++;
      } catch (err) {
        console.error(`[trial-expiry-sweep] lapse announcement failed for ${h.id}:`, err.message);
      }
    }
    if (announced > 0) console.log(`[trial-expiry-sweep] lapse deal announced to ${announced} household(s)`);
  } catch (err) {
    console.error('[trial-expiry-sweep] lapse announcement pass failed:', err.message);
  }
  return { announced };
}

async function runTrialExpirySweep() {
  let overdue;
  try {
    // select('*') so the pre-migration absence of complimentary_until can't
    // 400 the fetch and silently stop the sweep.
    const { data, error } = await supabaseAdmin
      .from('households')
      .select('*')
      .eq('subscription_status', 'trialing')
      .eq('is_internal', false)   // middleware never applies status logic to internal rows; neither do we
      .is('trial_paused_at', null)
      .lt('trial_ends_at', new Date().toISOString());
    if (error) throw error;
    // A live complimentary credit (referral reward / goodwill grant) keeps
    // access regardless of trial state - mirror the middleware and leave
    // those rows alone until the credit runs out.
    const nowMs = Date.now();
    overdue = (data || []).filter(
      (h) => !(h.complimentary_until && new Date(h.complimentary_until).getTime() > nowMs)
    );
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

  // After the flips, announce the free deal to any lapsed household that
  // hasn't been told (no-op until FREE_APP_MODE + the approved template
  // SID are both configured).
  const { announced } = await announceLapsedDeals();

  return { flipped, failed, announced };
}

module.exports = { runTrialExpirySweep, announceLapsedDeals };
