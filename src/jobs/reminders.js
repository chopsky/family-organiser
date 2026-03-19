const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const { getWeatherReport, getCoordsFromTimezone } = require('../services/weather');

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
function buildDailyReminderMessage(user, myTasks, allTasks, shoppingCount, weatherBrief, schoolActivities) {
  const today = new Date().toISOString().split('T')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const lines = [`${greeting}, ${user.name}! Here's what's on for today:\n`];

  // Weather brief (if available)
  if (weatherBrief) {
    lines.push(weatherBrief);
    lines.push('');
  }

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
  const { data: everyoneTasks } = await require('../db/client').supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .is('assigned_to', null)
    .lte('due_date', today);

  const targets = singleMember ? [singleMember] : await db.getHouseholdMembers(householdId);

  for (const member of targets) {
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

    // Fetch brief weather — use GPS coords or fall back to timezone-based coords
    let weatherBrief = null;
    const tz = member.timezone || 'Europe/London';
    let wLat = member.latitude;
    let wLon = member.longitude;
    if (!wLat || !wLon) {
      const tzCoords = getCoordsFromTimezone(tz);
      if (tzCoords) [wLat, wLon] = tzCoords;
    }
    if (wLat && wLon) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${wLat}&longitude=${wLon}&current=temperature_2m,apparent_temperature,weather_code&timezone=${encodeURIComponent(tz)}`;
        const weatherRes = await fetch(url);
        if (weatherRes.ok) {
          const wd = await weatherRes.json();
          const c = wd.current;
          const codes = { 0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌦️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'❄️',95:'⛈️',96:'⛈️',99:'⛈️' };
          const icon = codes[c.weather_code] || '🌡️';
          weatherBrief = `${icon} *Weather:* ${Math.round(c.temperature_2m)}°C (feels like ${Math.round(c.apparent_temperature)}°C)`;
        }
      } catch { /* silently skip weather on error */ }
    }

    // Get today's school activities for children in this household
    // Only include if today is during term time (not half term, INSET, or holiday)
    let schoolActivities = [];
    try {
      const dayOfWeek = (new Date().getDay() + 6) % 7; // Convert JS day (0=Sun) to our format (0=Mon)
      if (dayOfWeek <= 4) { // Only Mon-Fri
        const todayStr = new Date().toISOString().split('T')[0];
        const schools = await db.getHouseholdSchools(householdId);
        const dependents = members.filter(m => m.member_type === 'dependent' && m.school_id);

        for (const child of dependents) {
          // Check if today is during term time for this child's school
          const school = schools.find(s => s.id === child.school_id);
          if (school) {
            const termDates = await db.getSchoolTermDates(school.id);
            // Check if today is an INSET day or bank holiday
            const isInsetOrHoliday = termDates.some(td =>
              (td.event_type === 'inset_day' || td.event_type === 'bank_holiday') &&
              td.date === todayStr
            );
            // Check if today is during half term
            const isHalfTerm = termDates.some(td =>
              (td.event_type === 'half_term_start' || td.event_type === 'half_term_end') &&
              td.end_date && td.date <= todayStr && td.end_date >= todayStr
            );
            if (isInsetOrHoliday || isHalfTerm) continue; // Skip this child's activities
          }

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
      weatherBrief,
      schoolActivities
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
