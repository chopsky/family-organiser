/**
 * Ping router - "conversation on WhatsApp, pings on push"
 * (docs/spec-free-app-paid-assistant.md, channel doctrine).
 *
 * A PING is a one-way notification: event reminders, task reminders, the
 * overdue nudge, school prep. They route to PUSH for everyone, both
 * tiers - zero marginal cost, zero Meta surface - and push.sendToUser
 * also writes the in-app notification centre, so web-only users keep a
 * durable copy. WhatsApp no longer carries pings at all.
 *
 * The transition kindness: a push-unreachable, WhatsApp-linked member
 * (no device tokens - the ~25% web-only/permission-declined segment)
 * gets ONE WhatsApp heads-up ever, sent the first time a ping would
 * have reached them, exactly when the change is felt. The stamp is an
 * atomic conditional UPDATE (ping_notice_at IS NULL), so retries and
 * concurrent jobs can't double-send; pre-migration the stamp throws and
 * the notice is SKIPPED (no stamp = repeat risk = worse than waiting).
 *
 * Conversation stays where it was: the bot, briefs (premium), and the
 * capture openers are NOT pings and never route through here.
 */

const db = require('../db/queries');
const push = require('./push');
const { sendBroadcastToMember } = require('./whatsapp-templates');

const ROUTING_NOTICE = [
  'Quick heads-up: your Housemait reminders now arrive as app notifications instead of WhatsApp messages.',
  'To keep getting them, open the Housemait app and allow notifications - or grab the app at housemait.com/download.',
].join('\n');

/**
 * Deliver one ping to one member. Returns { channel } for logging:
 * 'push' (device reached), 'centre' (recorded in-app only - no device
 * or category muted), plus noticed:true the one time the WhatsApp
 * heads-up went out.
 */
async function deliverPing(member, { title, body, data, category, householdId } = {}) {
  if (!member?.id) return { channel: 'skipped' };
  let result = { sent: 0 };
  try {
    result = await push.sendToUser(member.id, { title, body, data, category, householdId });
  } catch (err) {
    console.warn('[ping-router] push send failed:', err.message);
  }
  if (result.sent > 0) return { channel: 'push' };

  // Nothing reached a device. If that's because they HAVE no device (as
  // opposed to muted prefs), the one-time WhatsApp heads-up may be owed.
  let noticed = false;
  try {
    const tokens = await db.getActiveDeviceTokens(member.id).catch(() => []);
    if ((!tokens || tokens.length === 0) && member.whatsapp_linked && member.whatsapp_phone) {
      const won = await db.markPingNoticeIfUnsent(member.id);
      if (won) {
        await sendBroadcastToMember(member, ROUTING_NOTICE);
        noticed = true;
      }
    }
  } catch (err) {
    // Pre-migration (column missing) or a WA hiccup: skip silently - the
    // in-app centre still holds the ping.
    console.warn('[ping-router] routing notice skipped:', err.message);
  }
  return { channel: 'centre', noticed };
}

module.exports = { deliverPing, ROUTING_NOTICE };
