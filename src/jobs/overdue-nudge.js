const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');

/**
 * Build a gentle personal nudge for overdue tasks.
 *
 * @param {object} user
 * @param {object[]} overdueTasks
 * @returns {string}
 */
function buildOverdueNudgeMessage(user, overdueTasks) {
  const today = new Date().toISOString().split('T')[0];
  const lines = [`Hey ${user.name} 👋\n`];
  lines.push(`Just a gentle nudge — you have ${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''}:\n`);

  for (const t of overdueTasks.slice(0, 10)) {
    const daysOverdue = Math.floor((new Date(today) - new Date(t.due_date)) / 86400000);
    const daysLabel = daysOverdue === 1 ? '1 day' : `${daysOverdue} days`;
    const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
    lines.push(`🔴 ${t.title}${rec} — overdue by ${daysLabel}`);
  }
  if (overdueTasks.length > 10) {
    lines.push(`… and ${overdueTasks.length - 10} more`);
  }

  lines.push('\nNo rush — just making sure nothing slips through! ✨');
  return lines.join('\n');
}

/**
 * Send overdue nudges to individual members of a household.
 * Only messages members who have tasks personally assigned to them that are overdue.
 * Does NOT send to the group or about unassigned tasks.
 *
 * @param {string} householdId
 */
async function sendOverdueNudges(householdId) {
  const members = await db.getHouseholdMembers(householdId);

  for (const member of members) {
    const hasWhatsApp = member.whatsapp_linked && member.whatsapp_phone;
    if (!hasWhatsApp) {
      console.log(`[overdue-nudge] Skipping ${member.name} — whatsapp_linked=${member.whatsapp_linked}, whatsapp_phone=${!!member.whatsapp_phone}`);
      continue;
    }

    const overdueTasks = await db.getOverdueTasksForUser(householdId, member.id);
    if (!overdueTasks.length) continue;

    const message = buildOverdueNudgeMessage(member, overdueTasks);

    // Send via WhatsApp
    if (whatsapp.isConfigured()) {
      try {
        await whatsapp.sendTemplate(member.whatsapp_phone, message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'overdue_nudge',
          body: message,
        });
      } catch (err) {
        console.error(`Failed to send overdue nudge to ${member.name} via WhatsApp:`, err.message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'overdue_nudge',
          body: message,
          error: err.message,
        });
      }
    } else {
      console.log(`[overdue-nudge] Skipping ${member.name} — whatsapp service not configured`);
    }
  }
}

module.exports = { buildOverdueNudgeMessage, sendOverdueNudges };
