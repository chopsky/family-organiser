/**
 * Broadcast service — sends notifications to other household members
 * when someone makes a change via the bot or web app.
 *
 * Fire-and-forget: errors are logged but never block the caller.
 *
 * Under the hood each per-member send is routed by whatsapp-templates.js:
 * free-form text when the member is inside Meta's 24-hour customer-service
 * window, a pre-approved Content Template when they're outside it. That's
 * what stops passive recipients (who rarely reply to the bot) from silently
 * missing every notification 24 hours after their last inbound message.
 */

const { sendBroadcastToMember } = require('./whatsapp-templates');

/**
 * Send a notification to all household members except the sender.
 *
 * @param {string} senderId   - User ID of the person who made the change (skip them)
 * @param {object[]} members  - All household members (from db.getHouseholdMembers)
 * @param {string} message    - The notification text
 */
function toHousehold(senderId, members, message) {
  for (const member of members) {
    if (member.id === senderId) continue;
    // Each send is async + fire-and-forget. Intentionally not awaited so one
    // slow recipient can't hold up the rest.
    sendBroadcastToMember(member, message);
  }
}

module.exports = { toHousehold };
