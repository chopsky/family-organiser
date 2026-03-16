const db = require('../db/queries');
const email = require('../services/email');
const whatsapp = require('../services/whatsapp');

// ─── Message builder ──────────────────────────────────────────────────────────

/**
 * Build the weekly digest text for a single user.
 *
 * @param {object} user
 * @param {string} householdName
 * @param {object[]} completedTasks   - Tasks completed this week
 * @param {object[]} completedShopping - Shopping items completed this week
 * @param {object[]} outstandingTasks - Incomplete tasks (overdue or carrying over)
 * @param {object[]} upcomingTasks    - Tasks due in the next 7 days
 * @param {object[]} members
 * @returns {string}
 */
function buildWeeklyDigestMessage(user, householdName, completedTasks, completedShopping, outstandingTasks, upcomingTasks, members) {
  const today = new Date().toISOString().split('T')[0];
  const lines = [`📊 *Weekly roundup for ${householdName}*\n`];

  // ── Completed this week ──
  lines.push(`✅ *COMPLETED THIS WEEK:* ${completedTasks.length} task${completedTasks.length !== 1 ? 's' : ''}, ${completedShopping.length} shopping item${completedShopping.length !== 1 ? 's' : ''}`);

  if (completedTasks.length) {
    // Summarise per person
    const byPerson = {};
    for (const t of completedTasks) {
      const key = t.assigned_to_name || 'Everyone';
      byPerson[key] = (byPerson[key] || 0) + 1;
    }
    for (const [name, count] of Object.entries(byPerson)) {
      lines.push(`  • ${name}: ${count} task${count !== 1 ? 's' : ''}`);
    }
  }
  lines.push('');

  // ── Carrying over (outstanding) ──
  if (outstandingTasks.length) {
    lines.push(`⏳ *CARRYING OVER:* ${outstandingTasks.length} task${outstandingTasks.length !== 1 ? 's' : ''} still outstanding`);
    for (const t of outstandingTasks.slice(0, 8)) {
      const who = t.assigned_to_name || 'Everyone';
      const overdue = t.due_date < today;
      const label = overdue ? ` _(overdue, was due ${t.due_date})_` : '';
      lines.push(`  🔴 ${who} — ${t.title}${label}`);
    }
    if (outstandingTasks.length > 8) lines.push(`  … and ${outstandingTasks.length - 8} more`);
    lines.push('');
  } else {
    lines.push('⏳ *CARRYING OVER:* Nothing — all caught up! 🎉\n');
  }

  // ── Coming up next week ──
  if (upcomingTasks.length) {
    lines.push(`📅 *COMING UP NEXT WEEK:* ${upcomingTasks.length} task${upcomingTasks.length !== 1 ? 's' : ''} due`);
    for (const t of upcomingTasks.slice(0, 8)) {
      const who = t.assigned_to_name || 'Everyone';
      const dayName = new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' });
      const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
      lines.push(`  📌 ${dayName}: ${who} — ${t.title}${rec}`);
    }
    if (upcomingTasks.length > 8) lines.push(`  … and ${upcomingTasks.length - 8} more`);
  } else {
    lines.push('📅 *COMING UP NEXT WEEK:* Nothing scheduled — enjoy the week!');
  }

  return lines.join('\n').trim();
}

/**
 * Send the weekly digest to all members of one household.
 *
 * @param {object} bot
 * @param {string} householdId
 */
async function sendWeeklyDigest(bot, householdId) {
  const today = new Date().toISOString().split('T')[0];
  const household = await db.getHouseholdById(householdId);
  const members = await db.getHouseholdMembers(householdId);

  const { tasks: completedTasks, shoppingItems: completedShopping } = await db.getCompletedThisWeek(householdId);

  // Outstanding = all incomplete tasks (overdue + carrying over)
  const { data: outstandingTasks } = await require('../db/client').supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .lte('due_date', today)
    .order('due_date');

  const upcomingTasks = await db.getTasksDueNextWeek(householdId);

  const message = buildWeeklyDigestMessage(
    null, // digest is the same for all members; personalisation can be added later
    household.name,
    completedTasks,
    completedShopping,
    outstandingTasks || [],
    upcomingTasks,
    members
  );

  for (const member of members) {
    const hasTelegram = !!member.telegram_chat_id;
    const hasWhatsApp = member.whatsapp_linked && member.whatsapp_phone;
    if (!hasTelegram && !hasWhatsApp) continue;

    // Send via Telegram
    if (hasTelegram) {
      try {
        await bot.telegram.sendMessage(member.telegram_chat_id, message, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`Failed to send digest to ${member.name} via Telegram:`, err.message);
      }
    }

    // Send via WhatsApp
    if (hasWhatsApp && whatsapp.isConfigured()) {
      try {
        await whatsapp.sendTemplate(member.whatsapp_phone, message);
      } catch (err) {
        console.error(`Failed to send digest to ${member.name} via WhatsApp:`, err.message);
      }
    }
  }
}

/**
 * Send the weekly digest via email to all members with an email address.
 *
 * @param {string} householdId
 */
async function sendWeeklyDigestEmail(householdId) {
  const today = new Date().toISOString().split('T')[0];
  const household = await db.getHouseholdById(householdId);
  const members = await db.getHouseholdMembers(householdId);

  const { tasks: completedTasks, shoppingItems: completedShopping } = await db.getCompletedThisWeek(householdId);

  const { data: outstandingTasks } = await require('../db/client').supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .lte('due_date', today)
    .order('due_date');

  const upcomingTasks = await db.getTasksDueNextWeek(householdId);

  for (const member of members) {
    if (!member.email) continue;

    try {
      await email.sendWeeklyDigestEmail(member.email, member.name, household.name, {
        completedTasks,
        completedShopping,
        outstandingTasks: outstandingTasks || [],
        upcomingTasks,
        members,
      });
    } catch (err) {
      console.error(`Failed to send digest email to ${member.name} (${member.email}):`, err.message);
    }
  }
}

module.exports = { buildWeeklyDigestMessage, sendWeeklyDigest, sendWeeklyDigestEmail };
