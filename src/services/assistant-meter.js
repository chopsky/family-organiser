/**
 * The assistant meter - free households get 10 AI uses a month
 * (docs/spec-free-app-paid-assistant.md).
 *
 * Unit: one USE per user-initiated request - every message, photo,
 * document or email counts one. The single exception is the CHAIN rule:
 * answering the bot's open question never charges (callers pass
 * isChainReply) - charging someone for answering our own question is
 * the toxic case every simpler rule exists to avoid. Bursts were tried
 * and removed (founder call 2026-08-28): real families land in the same
 * place under either design, and flat counting explains itself.
 *
 * Reset: calendar month in the HOUSEHOLD's timezone, so "your free
 * uses are back on 1 September" is always true as written.
 *
 * Fail-open doctrine throughout: a broken meter must never block the bot
 * or crash a reply. Every DB error here degrades to "allowed, uncharged"
 * with a warn - the meter is a business rule, not a safety system.
 */

const { supabase } = require('../db/client');

const FREE_MONTHLY_ACTIONS = 10;
// Counter lines are silent mid-tank: shown on the month's first use (the
// full-tank line doubles as the deal restatement) and from 7 (the
// countdown - the last few). See "Quota visibility" in the spec.
const COUNTDOWN_FROM = 7;

/** Read at call time (not module load) so tests and Railway flag flips
 *  behave without a restart-ordering trap. */
function enabled() {
  const v = String(process.env.FREE_APP_MODE || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Is this household on the metered free tier? Trial, active, internal and
 * complimentary households are unlimited; only a genuinely lapsed
 * household meters - and only while the mode is switched on.
 */
function isMeteredHousehold(household) {
  if (!enabled() || !household) return false;
  if (household.is_internal) return false;
  if (household.complimentary_until && new Date(household.complimentary_until) > new Date()) return false;
  return household.subscription_status === 'expired' || household.subscription_status === 'cancelled';
}

/** First instant of the current month in the household's timezone, as a
 *  UTC Date. en-CA gives YYYY-MM-DD parts directly. */
function monthStartUtc(timezone, now = new Date()) {
  const tz = timezone || 'Europe/London';
  let y; let m;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
      .format(now).split('-');
    y = Number(parts[0]); m = Number(parts[1]);
  } catch {
    y = now.getUTCFullYear(); m = now.getUTCMonth() + 1;
  }
  // Walk back from a UTC guess until the local wall-clock month matches -
  // handles both signs of offset without hardcoding any zone rules.
  let candidate = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  for (let i = 0; i < 30; i++) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(candidate).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    if (Number(local.month) === m && Number(local.day) === 1 && local.hour === '00' && local.minute === '00') break;
    // Nudge by the local offset from midnight-on-the-1st.
    const localMs = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute));
    const target = Date.UTC(y, m - 1, 1, 0, 0);
    candidate = new Date(candidate.getTime() + (target - localMs));
  }
  return candidate;
}

/** The 1st of next month, phrased for copy ("1 September"). */
function resetDateLabel(timezone, now = new Date()) {
  const tz = timezone || 'Europe/London';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .format(now).split('-');
  const next = new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 1, 12));
  return `1 ${new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(next)}`;
}

/**
 * The household's meter state this month: uses so far and whether they
 * are out. Fail-open: on any error the household reads as unmetered for
 * this turn.
 */
async function meterStatus(household, { now = new Date(), db = supabase } = {}) {
  const base = {
    metered: isMeteredHousehold(household),
    used: 0,
    limit: FREE_MONTHLY_ACTIONS,
    exhausted: false,
    resetLabel: resetDateLabel(household?.timezone, now),
  };
  if (!base.metered) return base;
  try {
    const since = monthStartUtc(household.timezone, now).toISOString();
    const { data, error } = await db
      .from('assistant_actions')
      .select('started_at')
      .eq('household_id', household.id)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(FREE_MONTHLY_ACTIONS + 5);
    if (error) throw error;
    const rows = data || [];
    base.used = rows.length;
    base.exhausted = rows.length >= FREE_MONTHLY_ACTIONS;
    return base;
  } catch (err) {
    console.warn('[assistant-meter] status failed (migration pending?), failing open:', err.message);
    return { ...base, metered: false, failedOpen: true };
  }
}

/**
 * Charge one use for this turn. No-ops (and reports charged:false) on
 * chain replies and on any failure. Returns the post-charge used count
 * for counter lines.
 */
async function chargeUse(household, { userId, channel, isChainReply = false, now = new Date(), db = supabase } = {}) {
  const status = await meterStatus(household, { now, db });
  if (!status.metered) return { charged: false, ...status };
  if (isChainReply) return { charged: false, ...status };
  try {
    const { error } = await db.from('assistant_actions').insert({
      household_id: household.id,
      user_id: userId || null,
      channel: channel || null,
      started_at: now.toISOString(),
    });
    if (error) throw error;
    return { charged: true, ...status, used: status.used + 1, exhausted: status.used + 1 >= status.limit };
  } catch (err) {
    console.warn('[assistant-meter] charge failed, failing open:', err.message);
    return { charged: false, ...status };
  }
}

// ─── Copy builders (pure - keep every user-facing meter word here) ──────────

/** The one quiet line under a reply. The month's first use gets the
 *  full-tank restatement; the countdown runs over the last few; silence
 *  in between. */
function counterLine(used, resetLabel) {
  if (used === 1) return `_(1 of ${FREE_MONTHLY_ACTIONS} free AI uses this month - they reset on ${resetLabel})_`;
  if (used >= COUNTDOWN_FROM && used < FREE_MONTHLY_ACTIONS) return `_(${used} of ${FREE_MONTHLY_ACTIONS} free AI uses this month)_`;
  if (used === FREE_MONTHLY_ACTIONS) return null; // the limit announcement handles this one
  return null;
}

/** Appended to the reply that consumes the final use - the request
 *  itself still completed. */
function limitAnnouncement(resetLabel, webUrl) {
  const base = (webUrl || 'https://housemait.com').replace(/\/+$/, '');
  return [
    `That was the last of your ${FREE_MONTHLY_ACTIONS} free AI uses this month - they're back on ${resetLabel}.`,
    '',
    `Everything else keeps working: add and manage it all in the app, free, any time. Or go unlimited with Premium: ${base}/subscribe`,
  ].join('\n');
}

/** The full over-limit reply (at most once a day per household). */
function limitReplyFull(resetLabel, webUrl) {
  const base = (webUrl || 'https://housemait.com').replace(/\/+$/, '');
  return [
    `That's all ${FREE_MONTHLY_ACTIONS} of your free AI uses for this month - they're back on ${resetLabel}.`,
    '',
    'The app itself is free forever - you can add events, lists, tasks and meals there any time.',
    `Want me unlimited? Premium is £5.99/month: ${base}/subscribe`,
  ].join('\n');
}

/** The short over-limit reply (per new burst after the daily full one). */
function limitReplyShort(resetLabel, webUrl) {
  const base = (webUrl || 'https://housemait.com').replace(/\/+$/, '');
  return `Out of free AI uses until ${resetLabel} - add it in the app, or go unlimited: ${base}/subscribe`;
}

/** The deal restatement prepended to the FIRST bot reply after lapse -
 *  free, in-window by definition, so no one can reach action 7 untold. */
function dealAnnouncement() {
  return [
    'Quick heads-up: your free trial has ended, and Housemait is now free for your family - the app, calendar, lists, meals and tasks all keep working.',
    `I can help with ${FREE_MONTHLY_ACTIONS} free AI uses a month (this was one), resetting on the 1st. Premium makes me unlimited.`,
  ].join('\n');
}

/** Deterministic quota question detector - meta-questions are free and
 *  never touch a model. */
function isQuotaQuestion(text) {
  const t = String(text || '').toLowerCase();
  if (t.length > 120) return false;
  return /how many (free )?(assistant )?(actions?|requests?|uses|messages?|prompts?)\b.*\b(left|remaining|used|have)|\b(actions?|requests?|uses)\b.*\bleft\b|what('| i)?s my (limit|quota|usage)|how much of my (limit|quota)/i.test(t);
}

/** The exact quota answer. */
function quotaAnswer(status) {
  if (!status.metered) {
    return 'No limits on your plan - ask me as much as you like. 👍';
  }
  const left = Math.max(0, status.limit - status.used);
  if (left === 0) return `That's all ${status.limit} of your free AI uses this month - they reset on ${status.resetLabel}. (Asking me this is always free.)`;
  return `You've used ${status.used} of your ${status.limit} free AI uses this month - ${left} left, resetting on ${status.resetLabel}. (Asking me this is always free.)`;
}

module.exports = {
  enabled,
  isMeteredHousehold,
  meterStatus,
  chargeUse,
  monthStartUtc,
  resetDateLabel,
  counterLine,
  limitAnnouncement,
  limitReplyFull,
  limitReplyShort,
  dealAnnouncement,
  isQuotaQuestion,
  quotaAnswer,
  FREE_MONTHLY_ACTIONS,
};
