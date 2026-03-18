const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');

// ─── Message builders (pure functions — easy to test) ─────────────────────────

/**
 * Build the daily reminder text for a single user.
 *
 * @param {object} user        - User row from DB
 * @param {object[]} myTasks   - Tasks assigned to this user (overdue + today)
 * @param {object[]} allTasks  - Tasks assigned to everyone (overdue + today)
 * @param {number} shoppingCount - Number of incomplete shopping items
 * @returns {string}
 */
function buildDailyReminderMessage(user, myTasks, allTasks, shoppingCount) {
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const lines = [`${greeting}, ${user.name}! Here's what's on for today:\n`];

  // Personal tasks
  if (myTasks.length) {
    lines.push('📋 *YOUR TASKS:*');
    for (const t of myTasks) {
      const overdue = t.due_date < today;
      const icon = overdue ? '🔴' : '🟡';
      const daysOverdue = overdue
        ? Math.floor((new Date(today) - new Date(t.due_date)) / 86400000)
        : 0;
      const label = overdue ? ` _(overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''})_` : ' _(due today)_';
      const rec = t.recurrence ? ` [${t.recurrence}]` : '';
      lines.push(`${icon} ${t.title}${rec}${label}`);
    }
    lines.push('');
  }

  // Household tasks (everyone)
  if (allTasks.length) {
    lines.push('🏠 *HOUSEHOLD TASKS (everyone):*');
    for (const t of allTasks) {
      const overdue = t.due_date < today;
      const icon = overdue ? '🔴' : '🟡';
      const rec = t.recurrence ? ` [${t.recurrence}]` : '';
      const label = overdue ? ' _(overdue)_' : ' _(due today)_';
      lines.push(`${icon} ${t.title}${rec}${label}`);
    }
    lines.push('');
  }

  if (!myTasks.length && !allTasks.length) {
    lines.push('✅ Nothing due today — enjoy your day!');
    lines.push('');
  }

  // Shopping summary
  if (shoppingCount > 0) {
    lines.push(`🛒 *SHOPPING:* ${shoppingCount} item${shoppingCount !== 1 ? 's' : ''} on the list. Reply /shopping to see it.`);
  } else {
    lines.push('🛒 *SHOPPING:* List is empty — all done!');
  }

  return lines.join('\n').trim();
}

/**
 * Send daily reminders to all connected members of one household.
 *
 * @param {string} householdId
 */
async function sendDailyReminders(householdId) {
  const today = new Date().toISOString().split('T')[0];
  const members = await db.getHouseholdMembers(householdId);
  const shoppingItems = await db.getShoppingList(householdId);
  const shoppingCount = shoppingItems.length;

  // All tasks due today or overdue, assigned to everyone (null)
  const { data: everyoneTasks } = await require('../db/client').supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .is('assigned_to', null)
    .lte('due_date', today);

  for (const member of members) {
    const hasWhatsApp = member.whatsapp_linked && member.whatsapp_phone;
    if (!hasWhatsApp) continue;

    // Tasks assigned specifically to this member, due today or overdue
    const { data: myTasks } = await require('../db/client').supabase
      .from('tasks')
      .select()
      .eq('household_id', householdId)
      .eq('completed', false)
      .eq('assigned_to', member.id)
      .lte('due_date', today);

    const message = buildDailyReminderMessage(
      member,
      myTasks || [],
      everyoneTasks || [],
      shoppingCount
    );

    // Send via WhatsApp
    if (whatsapp.isConfigured()) {
      try {
        await whatsapp.sendTemplate(member.whatsapp_phone, message);
      } catch (err) {
        console.error(`Failed to send reminder to ${member.name} via WhatsApp:`, err.message);
      }
    }
  }
}

module.exports = { buildDailyReminderMessage, sendDailyReminders };
