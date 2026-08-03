/**
 * Broadcast service - notifies other household members when someone makes a
 * change via the bot or web app.
 *
 * ONE notification per member, not one per channel. Each member is routed:
 *   • has the app (active push devices) → app push ONLY
 *   • no app → WhatsApp ONLY (via whatsapp-templates: free-form inside
 *     Meta's 24h window, pre-approved Content Template outside it)
 *
 * Before this (2026-08-03 founder report), members with both the app and
 * WhatsApp linked got every family action twice - a "Housemait update" on
 * WhatsApp AND a push. Callers must therefore NOT pair toHousehold with
 * their own push.sendToHousehold for the same action - pass the push title/
 * category here instead and let the routing decide per member.
 *
 * A member with the app who has DISABLED the pushed category gets nothing at
 * all - deliberately. They said "don't notify me about this"; falling back
 * to WhatsApp would bypass that choice.
 *
 * Fire-and-forget: errors are logged but never block the caller.
 */

const { sendBroadcastToMember } = require('./whatsapp-templates');
const push = require('./push');
const db = require('../db/queries');

/**
 * Notify all household members except the sender.
 *
 * @param {string}   senderId - User ID of the person who made the change (skip them)
 * @param {object[]} members  - All household members (from db.getHouseholdMembers)
 * @param {string}   message  - The WhatsApp notification text
 * @param {object}   [pushOpts] - Optional push presentation: { title, body, category }.
 *                   Defaults keep broadcast-only call sites working: title
 *                   "Housemait update", body = the WhatsApp message.
 */
function toHousehold(senderId, members, message, pushOpts = {}) {
  for (const member of members || []) {
    if (member.id === senderId) continue;
    // Each member routes independently and is not awaited, so one slow
    // recipient can't hold up the rest.
    routeToMember(member, message, pushOpts).catch((err) => {
      console.error(`[broadcast] notify failed for member ${member.id}:`, err.message);
    });
  }
}

async function routeToMember(member, message, pushOpts) {
  let hasApp = false;
  try {
    const tokens = await db.getActiveDeviceTokens(member.id);
    hasApp = Array.isArray(tokens) && tokens.length > 0;
  } catch { /* token lookup down → fall through to WhatsApp */ }

  if (hasApp) {
    await push.sendToUser(member.id, {
      title: pushOpts.title || 'Housemait update',
      body: pushOpts.body || message,
      category: pushOpts.category,
    });
    return;
  }
  sendBroadcastToMember(member, message);
}

module.exports = { toHousehold };
