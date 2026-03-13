const db = require('../db/queries');

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
 * @param {object} bot
 * @param {string} householdId
 */
async function sendOverdueNudges(bot, householdId) {
  const members = await db.getHouseholdMembers(householdId);

  for (const member of members) {
    if (!member.telegram_chat_id) continue;

    const overdueTasks = await db.getOverdueTasksForUser(householdId, member.id);
    if (!overdueTasks.length) continue;

    const message = buildOverdueNudgeMessage(member, overdueTasks);

    try {
      await bot.telegram.sendMessage(member.telegram_chat_id, message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`Failed to send overdue nudge to ${member.name} (${member.telegram_chat_id}):`, err.message);
    }
  }
}

module.exports = { buildOverdueNudgeMessage, sendOverdueNudges };
