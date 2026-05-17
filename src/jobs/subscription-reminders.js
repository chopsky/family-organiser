/**
 * Daily subscription-renewal nudge job.
 *
 * Runs once a day at 09:00 (household timezone — gated by scheduler.js).
 * Picks every household_subscriptions row whose `next_renewal_at` is
 * in the next 3 days, sends a WhatsApp nudge to every linked member,
 * marks the row as reminded for that date, and after the renewal day
 * passes, advances `next_renewal_at` by one cadence period.
 *
 * Idempotency: a row's `reminded_for_date` column stores the
 * `next_renewal_at` we last reminded for. If the same row comes up
 * again on the same date (e.g. a cron retry), the reminder is skipped.
 * Once the renewal date passes, the cron rolls `next_renewal_at`
 * forward to the next cycle and clears `reminded_for_date`, so a fresh
 * reminder will fire for the new cycle.
 */

const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const { formatMoney } = require('../utils/currency');
const { advanceRenewal } = require('../utils/subscription-renewal');

const REMINDER_LEAD_DAYS = 3;

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildReminderMessage(sub) {
  const renewLabel = new Date(sub.next_renewal_at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const price = sub.amount != null ? formatMoney(sub.amount, sub.currency) : '';
  const priceClause = price ? ` (${price})` : '';
  return [
    `💳 *${sub.name}*${priceClause} renews on *${renewLabel}*.`,
    '',
    `If you want to skip this one, cancel before then. Reply _"I cancelled ${sub.name}"_ and I\'ll stop tracking it.`,
  ].join('\n');
}

/**
 * Single-household pass. Called from the scheduler when its 09:00
 * local tick fires for this household.
 *
 * @param {string} householdId
 */
async function runSubscriptionRemindersForHousehold(householdId) {
  // Window: subscriptions renewing today through today + LEAD_DAYS.
  // We use TODAY as the lower bound (not today + LEAD) so a subscription
  // that renews on the exact reminder boundary gets one nudge and then
  // the cron advances the next_renewal_at past today.
  const today = new Date();
  const windowEnd = new Date(today);
  windowEnd.setDate(today.getDate() + REMINDER_LEAD_DAYS);

  const dueSubs = await db.getSubscriptionsRenewingBetween(ymd(today), ymd(windowEnd));
  const householdSubs = dueSubs.filter((s) => s.household_id === householdId);
  if (householdSubs.length === 0) return { sent: 0, advanced: 0 };

  const members = await db.getHouseholdMembers(householdId);
  const linked = members.filter((m) => m.whatsapp_linked && m.whatsapp_phone);

  let sent = 0;
  let advanced = 0;
  for (const sub of householdSubs) {
    // Has the renewal already passed? Advance forward and skip — we
    // don't want to nudge for a past date. The reminder for this
    // cycle has either already gone out or got missed for some reason.
    if (sub.next_renewal_at < ymd(today)) {
      const next = advanceRenewal(sub.next_renewal_at, sub.recurrence);
      await db.updateSubscriptionRenewal(sub.id, next, null);
      advanced += 1;
      continue;
    }

    // Already reminded for this exact renewal date? Skip.
    if (sub.reminded_for_date === sub.next_renewal_at) continue;

    const body = buildReminderMessage(sub);
    for (const member of linked) {
      try {
        await whatsapp.sendMessage(member.whatsapp_phone, body);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'subscription_reminder',
          body,
        });
      } catch (err) {
        console.error(`[subscription-reminders] failed to send to ${member.name}:`, err.message);
      }
    }
    await db.updateSubscriptionRenewal(sub.id, sub.next_renewal_at, sub.next_renewal_at);
    sent += 1;
  }

  return { sent, advanced };
}

module.exports = { runSubscriptionRemindersForHousehold, buildReminderMessage };
