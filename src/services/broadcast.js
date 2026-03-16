/**
 * Broadcast service — sends notifications to other household members
 * when someone makes a change via the bot.
 *
 * Supports both WhatsApp (Twilio) and Telegram channels.
 * Fire-and-forget: errors are logged but never block the caller.
 */

const whatsapp = require('./whatsapp');

/**
 * Send a notification to all household members except the sender.
 *
 * @param {string} senderId   - User ID of the person who made the change (skip them)
 * @param {object[]} members  - All household members (from db.getHouseholdMembers)
 * @param {string} message    - The notification text
 * @param {object} [bot]      - Telegraf bot instance (bot.telegram) for sending via Telegram
 */
function toHousehold(senderId, members, message, bot) {
  for (const member of members) {
    if (member.id === senderId) continue;

    // Send via WhatsApp
    if (member.whatsapp_linked && member.whatsapp_phone && whatsapp.isConfigured()) {
      whatsapp.sendMessage(member.whatsapp_phone, message).catch((err) => {
        console.error(`[broadcast] WhatsApp failed for ${member.name}:`, err.message);
      });
    }

    // Send via Telegram
    if (member.telegram_chat_id && bot) {
      bot.sendMessage(member.telegram_chat_id, message, { parse_mode: 'Markdown' }).catch((err) => {
        console.error(`[broadcast] Telegram failed for ${member.name}:`, err.message);
      });
    }
  }
}

module.exports = { toHousehold };
