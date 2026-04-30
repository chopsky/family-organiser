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
 * @param {object[]} schoolActivities - School activities for today
 * @returns {string}
 */
function buildDailyReminderMessage(user, myTasks, allTasks, shoppingCount, schoolActivities) {
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const lines = [`${greeting}, ${user.name}! Here's what's on for today:\n`];

  // School activities for today
  if (schoolActivities && schoolActivities.length > 0) {
    lines.push('🏫 *SCHOOL:*');
    for (const act of schoolActivities) {
      const timeStr = act.time_end ? ` until ${act.time_end.substring(0, 5)}` : '';
      lines.push(`• ${act.child_name} — ${act.activity}${timeStr}${act.reminder_text ? ` (${act.reminder_text})` : ''}`);
    }
    lines.push('');
  }

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
 * Send daily reminder to a specific member, or all connected members of a household.
 *
 * @param {string} householdId
 * @param {object} [singleMember] - If provided, only send to this member
 */
async function sendDailyReminders(householdId, singleMember) {
  const today = new Date().toISOString().split('T')[0];
  const shoppingItems = await db.getShoppingList(householdId);
  const shoppingCount = shoppingItems.length;

  // All tasks due today or overdue, assigned to everyone (null)
  const { data: everyoneTasks } = await require('../db/client').supabaseAdmin
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .is('assigned_to', null)
    .lte('due_date', today);

  const targets = singleMember ? [singleMember] : await db.getHouseholdMembers(householdId);

  for (const member of targets) {
    const hasWhatsApp = member.whatsapp_linked && member.whatsapp_phone;
    if (!hasWhatsApp) {
      console.log(`[reminders] Skipping ${member.name} — whatsapp_linked=${member.whatsapp_linked}, whatsapp_phone=${!!member.whatsapp_phone}`);
      continue;
    }

    // Tasks assigned specifically to this member, due today or overdue
    const { data: myTasks } = await require('../db/client').supabaseAdmin
      .from('tasks')
      .select()
      .eq('household_id', householdId)
      .eq('completed', false)
      .eq('assigned_to', member.id)
      .lte('due_date', today);

    // Get today's school activities for children in this household
    // Only include if today is during term time (not holidays, half term, INSET, or bank holiday)
    const schoolActivities = [];
    try {
      const dayOfWeek = (new Date().getDay() + 6) % 7; // Convert JS day (0=Sun) to our format (0=Mon)
      if (dayOfWeek <= 4) { // Only Mon-Fri
        const todayStr = new Date().toISOString().split('T')[0];
        const allMembers = await db.getHouseholdMembers(householdId);
        const dependents = allMembers.filter(m => m.member_type === 'dependent' && m.school_id);

        for (const child of dependents) {
          // Check if today is during term time for this child's school
          const { isSchoolInSession } = require('../utils/school-terms');
          const inSession = await isSchoolInSession(child.school_id, todayStr);
          if (!inSession) continue; // Skip — school holiday, inset day, half term, etc.

          const activities = await db.getChildActivities(child.id);
          const todayActivities = activities.filter(a => a.day_of_week === dayOfWeek && a.term_only !== false);
          for (const act of todayActivities) {
            schoolActivities.push({ ...act, child_name: child.name });
          }
        }
      }
    } catch { /* silently skip school activities on error */ }

    const message = buildDailyReminderMessage(
      member,
      myTasks || [],
      everyoneTasks || [],
      shoppingCount,
      schoolActivities
    );

    // Send via WhatsApp
    if (whatsapp.isConfigured()) {
      try {
        await whatsapp.sendTemplate(member.whatsapp_phone, message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'daily_reminder',
          body: message,
        });
      } catch (err) {
        console.error(`Failed to send reminder to ${member.name} via WhatsApp:`, err.message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: 'daily_reminder',
          body: message,
          error: err.message,
        });
      }
    } else {
      console.log(`[reminders] Skipping ${member.name} — whatsapp service not configured`);
    }
  }
}

module.exports = { buildDailyReminderMessage, sendDailyReminders };
