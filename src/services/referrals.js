/**
 * Referral scheme - "give a month, get a month" (phase 1).
 *
 * A household shares housemait.com/gift/<code>. A family that signs up
 * through it AND genuinely activates earns BOTH households 30 days of
 * complimentary Premium (households.complimentary_until - the credit the
 * subscription gate honours above every billing provider). Stacking is
 * allowed, capped at 365 days ahead.
 *
 * Activation gate (the anti-farm line - every signal here is something a
 * real family does without trying in week one):
 *   - INSTANT: a member links WhatsApp (needs a real SIM), or the
 *     household has 2+ members with any deliberate action.
 *   - EARNED: >=5 deliberate actions across >=2 distinct days within 14
 *     days of signup. "Deliberate" reuses the activation-retention
 *     definition (WRITE_SOURCES + manual calendar events, holidays and
 *     feed imports excluded - seeded holidays once made every dead
 *     household look active).
 *   - Neither within 30 days -> lapsed, silently.
 *
 * Anti-recycle rule: one referral reward per normalised EMAIL, ever,
 * platform-wide. referrals rows deliberately outlive the referred account
 * (plain uuid, no FK cascade) so refer -> activate -> delete -> re-refer
 * cannot mint a second reward.
 *
 * PILOT GATING: REFERRAL_PILOT_HOUSEHOLDS env var - comma-separated
 * household ids limits the feature to those; literal '*' opens it to all;
 * unset/empty disables it everywhere. Server-side only: /api/referrals/mine
 * answers { enabled: false } and the web surfaces render nothing.
 */

const { supabaseAdmin } = require('../db/client');
const db = require('../db/queries');

const REWARD_DAYS = 30;
const MAX_BANK_DAYS = 365;
const ACTIVATION_WINDOW_DAYS = 14;
const LAPSE_AFTER_DAYS = 30;
const ACTIVATION_MIN_ACTIONS = 5;
const ACTIVATION_MIN_DAYS = 2;

// No ambiguous chars (0/O, 1/I/L) - codes get read out at school gates.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function referralsEnabled(householdId) {
  const raw = (process.env.REFERRAL_PILOT_HOUSEHOLDS || '').trim();
  if (!raw) return false;
  if (raw === '*') return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(String(householdId));
}

/**
 * One email = one referral reward, ever. Normalise so trivial aliases
 * ("Foo+1@Gmail.com") can't mint fresh identities: lowercase and strip a
 * +tag from the local part. Full fraud-stack normalisation (gmail dot
 * stripping etc.) is deliberately out of scope - the activation gate is
 * the real wall.
 */
function normalizeReferralEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 1) return s;
  const local = s.slice(0, at).replace(/\+.*$/, '');
  return `${local}${s.slice(at)}`;
}

function mintCode() {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Lazy-mint the household's shareable code. Idempotent; retries on the
 *  (astronomically rare) unique collision. */
async function getOrCreateReferralCode(householdId) {
  const household = await db.getHouseholdById(householdId);
  if (!household) return null;
  if (household.referral_code) return household.referral_code;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = mintCode();
    const { data, error } = await supabaseAdmin
      .from('households')
      .update({ referral_code: code })
      .eq('id', householdId)
      .is('referral_code', null)
      .select('referral_code')
      .maybeSingle();
    if (!error && data?.referral_code) return data.referral_code;
    if (!error && !data) {
      // Lost a race to a concurrent mint - read the winner's code.
      const again = await db.getHouseholdById(householdId);
      if (again?.referral_code) return again.referral_code;
    }
    // Unique-index collision or transient error: try a fresh code.
  }
  return null;
}

async function findHouseholdByReferralCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(clean)) return null;
  const { data, error } = await supabaseAdmin
    .from('households')
    .select('id, name, referral_code')
    .eq('referral_code', clean)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/**
 * Called (fire-and-forget) after a NEW household is created. If the owner
 * carried a referral code at signup, record the pending referral - unless
 * any guard says no, in which case we silently do nothing (signup itself
 * is never affected; the person just isn't a rewarded referral).
 */
async function captureReferralOnHouseholdCreate({ userId, householdId }) {
  try {
    const user = await db.getUserById(userId);
    const code = String(user?.referred_by_code || '').trim().toUpperCase();
    if (!code) return null;

    const referrer = await findHouseholdByReferralCode(code);
    if (!referrer) return null;
    if (String(referrer.id) === String(householdId)) return null; // self

    const email = normalizeReferralEmail(user.email);
    if (!email) return null;

    // Referrer household members can't be their own referral.
    const members = await db.getHouseholdMembers(referrer.id).catch(() => []);
    if ((members || []).some((m) => normalizeReferralEmail(m.email) === email)) return null;

    // One reward per email EVER (any status, any referrer) - the row
    // outlives account deletion by design.
    const { data: prior } = await supabaseAdmin
      .from('referrals')
      .select('id')
      .eq('referred_email', email)
      .limit(1);
    if (prior && prior.length > 0) return null;

    const { data, error } = await supabaseAdmin
      .from('referrals')
      .insert({
        referrer_household_id: referrer.id,
        referred_household_id: householdId,
        referred_email: email,
        code,
        status: 'pending',
        reward_days: REWARD_DAYS,
      })
      .select()
      .single();
    if (error) {
      // Unique violation (household or email raced in) or unmigrated
      // table - both mean "no referral", never an error for the caller.
      return null;
    }
    return data;
  } catch (err) {
    console.warn('[referrals] capture skipped:', err.message);
    return null;
  }
}

// ─── Activation check (per referred household) ──────────────────────────────

// Same deliberate-action sources as activation-retention's WRITE_SOURCES,
// queried per-household (indexed) instead of estate-wide.
const ACTION_SOURCES = [
  { table: 'whatsapp_message_log', ts: 'created_at', filter: (q) => q.eq('direction', 'inbound') },
  { table: 'chat_messages', ts: 'created_at', filter: (q) => q.eq('role', 'user') },
  { table: 'shopping_items', ts: 'created_at', filter: (q) => q },
  { table: 'chore_completions', ts: 'completed_at', filter: (q) => q },
  { table: 'tasks', ts: 'created_at', filter: (q) => q },
  { table: 'meal_plan', ts: 'created_at', filter: (q) => q },
];

async function fetchHouseholdActionTimes(householdId, sinceIso, untilIso) {
  const times = [];
  for (const src of ACTION_SOURCES) {
    try {
      const { data } = await src
        .filter(supabaseAdmin.from(src.table).select(src.ts).eq('household_id', householdId))
        .gte(src.ts, sinceIso)
        .lte(src.ts, untilIso)
        .limit(200);
      for (const r of data || []) {
        const t = new Date(r[src.ts]).getTime();
        if (Number.isFinite(t)) times.push(t);
      }
    } catch { /* table missing or transient - other sources still count */ }
  }
  try {
    // Manual calendar events only - same exclusions as fetchManualCalendar
    // in activation-retention (feed imports + seeded holidays don't count).
    const { data } = await supabaseAdmin
      .from('calendar_events')
      .select('created_at')
      .eq('household_id', householdId)
      .is('external_feed_id', null)
      .is('subscription_id', null)
      .or('category.is.null,category.neq.public_holiday')
      .gte('created_at', sinceIso)
      .lte('created_at', untilIso)
      .limit(200);
    for (const r of data || []) {
      const t = new Date(r.created_at).getTime();
      if (Number.isFinite(t)) times.push(t);
    }
  } catch { /* best-effort */ }
  return times;
}

/**
 * Is the referred household genuinely activated?
 * Exported for tests; `deps` allows injecting the fetchers.
 */
async function isHouseholdActivated(householdId, referredAtIso, deps = {}) {
  const fetchMembers = deps.fetchMembers || ((id) => db.getHouseholdMembers(id));
  const fetchActions = deps.fetchActions || fetchHouseholdActionTimes;

  const referredAt = new Date(referredAtIso).getTime();
  const windowEnd = new Date(referredAt + ACTIVATION_WINDOW_DAYS * 86_400_000).toISOString();

  let members = [];
  try { members = (await fetchMembers(householdId)) || []; } catch { members = []; }

  // Tier 1a: a WhatsApp-linked member. A distinct SIM is the most
  // expensive signal to fake and the strongest retention signal we have.
  if (members.some((m) => m.whatsapp_linked || m.whatsapp_phone)) return true;

  const times = await fetchActions(householdId, new Date(referredAt).toISOString(), windowEnd);

  // Tier 1b: two-plus real people, and somebody has done something.
  const realMembers = members.filter((m) => !m.is_dependent && !m.is_child);
  if (realMembers.length >= 2 && times.length > 0) return true;

  // Tier 2: five deliberate actions across two distinct days in the window.
  if (times.length >= ACTIVATION_MIN_ACTIONS) {
    const days = new Set(times.map((t) => new Date(t).toISOString().slice(0, 10)));
    if (days.size >= ACTIVATION_MIN_DAYS) return true;
  }
  return false;
}

// ─── Reward grant ───────────────────────────────────────────────────────────

/**
 * Extend a household's complimentary credit by rewardDays. The credit banks
 * on TOP of whatever entitlement the household already holds - the reward
 * starts when their trial ends, their paid period ends, or their existing
 * credit runs out, whichever is furthest away (a credit that ran concurrently
 * with the trial would be worth nothing). Never sets the end more than
 * MAX_BANK_DAYS ahead (the 12-month bank cap).
 */
function complimentaryBaseMs(household, nowMs) {
  return Math.max(
    nowMs,
    household.trial_ends_at ? new Date(household.trial_ends_at).getTime() : 0,
    household.subscription_current_period_end
      ? new Date(household.subscription_current_period_end).getTime()
      : 0,
    household.complimentary_until ? new Date(household.complimentary_until).getTime() : 0,
  );
}

async function grantComplimentaryDays(householdId, rewardDays) {
  const household = await db.getHouseholdById(householdId);
  if (!household) return null;
  const nowMs = Date.now();
  const baseMs = complimentaryBaseMs(household, nowMs);
  const capMs = nowMs + MAX_BANK_DAYS * 86_400_000;
  const nextMs = Math.min(baseMs + rewardDays * 86_400_000, capMs);
  const nextIso = new Date(nextMs).toISOString();
  const { error } = await supabaseAdmin
    .from('households')
    .update({ complimentary_until: nextIso })
    .eq('id', householdId);
  if (error) {
    console.error('[referrals] credit update failed for', householdId, error.message);
    return null;
  }
  return nextIso;
}

async function notifyReferrerActivated(referrerHouseholdId) {
  try {
    const { sendBroadcastToMember } = require('./whatsapp-templates');
    const members = await db.getHouseholdMembers(referrerHouseholdId);
    const linked = (members || []).filter((m) => m.whatsapp_phone);
    // Generic on purpose: household names are private to their households.
    const message = `🎁 The family you invited are in! You've both got a free month of Housemait Premium on us. Thanks for spreading the word.`;
    for (const m of linked.slice(0, 2)) {
      await sendBroadcastToMember(m, message).catch(() => {});
    }
  } catch (err) {
    console.warn('[referrals] activation notify skipped:', err.message);
  }
}

/**
 * Settle one pending referral row: activated -> reward both sides + notify,
 * pending past LAPSE_AFTER_DAYS -> lapsed. The status UPDATE is conditional
 * on `status = 'pending'`, so the nightly sweep and an opportunistic settle
 * racing each other reward at most once. Returns 'activated' | 'lapsed' |
 * null (still pending / lost the race).
 */
async function settleReferral(ref, deps = {}) {
  const checkActivated = deps.isHouseholdActivated || isHouseholdActivated;
  const grant = deps.grantComplimentaryDays || grantComplimentaryDays;
  const notify = deps.notifyReferrerActivated || notifyReferrerActivated;

  const ageDays = (Date.now() - new Date(ref.created_at).getTime()) / 86_400_000;
  if (await checkActivated(ref.referred_household_id, ref.created_at)) {
    const { data, error } = await supabaseAdmin
      .from('referrals')
      .update({ status: 'activated', activated_at: new Date().toISOString() })
      .eq('id', ref.id)
      .eq('status', 'pending') // settle once even if two runs race
      .select('id');
    if (error || !data || data.length === 0) return null;
    await grant(ref.referrer_household_id, ref.reward_days || REWARD_DAYS);
    await grant(ref.referred_household_id, ref.reward_days || REWARD_DAYS);
    await notify(ref.referrer_household_id);
    return 'activated';
  }
  if (ageDays > LAPSE_AFTER_DAYS) {
    await supabaseAdmin
      .from('referrals')
      .update({ status: 'lapsed' })
      .eq('id', ref.id)
      .eq('status', 'pending');
    return 'lapsed';
  }
  return null;
}

/**
 * Daily job: settle pending referrals. Returns counts for logging.
 */
async function evaluateReferrals(deps = {}) {
  let pending = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('referrals')
      .select('*')
      .eq('status', 'pending');
    if (error) throw error;
    pending = data || [];
  } catch (err) {
    // Table not migrated yet - quietly a no-op.
    return { activated: 0, lapsed: 0, pending: 0, skipped: err.message };
  }

  let activated = 0;
  let lapsed = 0;
  for (const ref of pending) {
    try {
      const outcome = await settleReferral(ref, deps);
      if (outcome === 'activated') activated++;
      else if (outcome === 'lapsed') lapsed++;
    } catch (err) {
      console.error('[referrals] evaluate failed for', ref.id, err.message);
    }
  }
  if (activated || lapsed) {
    console.log(`[referrals] evaluated: ${activated} activated, ${lapsed} lapsed, ${pending.length - activated - lapsed} still pending`);
  }
  return { activated, lapsed, pending: pending.length - activated - lapsed };
}

/**
 * Opportunistic settle for ONE household, fired when it crosses an
 * instant-qualify moment (linking WhatsApp). Without this the reward waits
 * for the nightly sweep - and the referred family's "I've signed up, did
 * you get your month?" conversation happens hours before the credit lands.
 * Fire-and-forget at call sites; never throws.
 */
async function settleReferralForHousehold(referredHouseholdId, deps = {}) {
  if (!referredHouseholdId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('referrals')
      .select('*')
      .eq('referred_household_id', referredHouseholdId)
      .eq('status', 'pending')
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return await settleReferral(data[0], deps);
  } catch (err) {
    // Unmigrated table or transient DB error - the nightly sweep covers it.
    console.warn('[referrals] opportunistic settle skipped:', err.message);
    return null;
  }
}

/**
 * The household's own INBOUND gift, if any (they were referred and it's
 * still pending). Powers the Dashboard "your bonus month unlocks once
 * you're up and running" card, which answers the referred family's
 * "what do I need to do?" moment with directional guidance. NOT pilot-
 * gated: a pending row can only exist via a pilot referrer, and the
 * recipient is by definition outside the pilot list.
 */
async function getIncomingReferral(householdId) {
  try {
    const { data } = await supabaseAdmin
      .from('referrals')
      .select('status, referrer_household_id')
      .eq('referred_household_id', householdId)
      .eq('status', 'pending')
      .maybeSingle();
    if (!data) return null;
    // No giver name: household names are private (see the gift endpoint).
    // The recipient knows who shared the link with them.
    return { status: 'pending' };
  } catch {
    return null; // unmigrated table - no gift card
  }
}

/** Summary for GET /api/referrals/mine. */
async function getReferralStateForHousehold(householdId) {
  const code = await getOrCreateReferralCode(householdId);
  let pending = 0;
  let activatedCount = 0;
  try {
    const { data } = await supabaseAdmin
      .from('referrals')
      .select('status')
      .eq('referrer_household_id', householdId);
    for (const r of data || []) {
      if (r.status === 'pending') pending++;
      if (r.status === 'activated') activatedCount++;
    }
  } catch { /* unmigrated - zeros */ }
  const household = await db.getHouseholdById(householdId);
  const compUntil = household?.complimentary_until || null;
  const bankedDays = compUntil && new Date(compUntil) > new Date()
    ? Math.ceil((new Date(compUntil).getTime() - Date.now()) / 86_400_000)
    : 0;
  return {
    code,
    share_url: code ? `https://housemait.com/gift/${code}` : null,
    pending,
    activated: activatedCount,
    banked_days: bankedDays,
  };
}

module.exports = {
  REWARD_DAYS,
  MAX_BANK_DAYS,
  referralsEnabled,
  normalizeReferralEmail,
  getOrCreateReferralCode,
  findHouseholdByReferralCode,
  captureReferralOnHouseholdCreate,
  isHouseholdActivated,
  complimentaryBaseMs,
  grantComplimentaryDays,
  evaluateReferrals,
  settleReferralForHousehold,
  getReferralStateForHousehold,
  getIncomingReferral,
};
