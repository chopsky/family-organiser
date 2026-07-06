const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const push = require('../services/push');
const { generateMorningBriefPush } = require('../services/morning-brief');
const { pickDigestFooter } = require('../utils/whatsapp-tips');
const { buildDigestWeatherLine } = require('../utils/weather-line');
const { fetchTodayForecastForHousehold } = require('../services/digest-weather');

/**
 * Pick the delivery channel for a member's morning brief.
 *
 * The brief is ONE notification delivered on the member's best channel:
 *   - app installed (has device tokens) → iOS push (free, free-form, tappable)
 *   - otherwise WhatsApp (the legacy path)
 * If the member has turned the brief off, or has no channel at all, returns
 * null (skip). Pure + exported for testing.
 *
 * @param {object} p
 * @param {boolean} p.hasDevices     - member has ≥1 active push device token
 * @param {boolean} p.whatsappLinked - member has WhatsApp linked + a phone
 * @param {boolean} p.briefDisabled  - member opted out of the daily brief
 * @returns {'push'|'whatsapp'|null}
 */
function chooseDailyBriefChannel({ hasDevices, whatsappLinked, briefDisabled }) {
  if (briefDisabled) return null;
  if (hasDevices) return 'push';
  if (whatsappLinked) return 'whatsapp';
  return null;
}

// ─── Message builders (pure functions - easy to test) ─────────────────────────

/**
 * Format an ISO timestamp as HH:mm in the household's timezone.
 */
function formatEventTime(iso, tz) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false,
    });
  } catch {
    return String(iso).slice(11, 16);
  }
}

/**
 * Render the assignee bracket for an event. Prefers the join-table
 * `assignees` list (per-event reminder fanout, populated by the routes
 * layer); falls back to the event row's `assigned_to_names` array if
 * the join table wasn't queried.
 */
function formatEventAssignee(ev) {
  if (Array.isArray(ev.assignees) && ev.assignees.length > 0) {
    return ev.assignees.map(a => a.member_name).filter(Boolean).join(', ');
  }
  if (Array.isArray(ev.assigned_to_names) && ev.assigned_to_names.length > 0) {
    return ev.assigned_to_names.filter(Boolean).join(', ');
  }
  return '';
}

/**
 * Build the daily reminder text for a single user.
 *
 * Morning digest shape: school activities (if any), today's calendar
 * events, shopping count. Tasks are intentionally NOT included here -
 * a separate later-in-day nudge job surfaces overdue + due-today tasks
 * so the morning message stays focused on what's actually scheduled
 * for the day.
 *
 * @param {object} user                 - User row from DB
 * @param {object[]} todayEvents        - Calendar events for today
 *                                        (already filtered + sorted)
 * @param {number} shoppingCount        - Number of incomplete shopping items
 * @param {object[]} schoolActivities   - School activities for today
 * @param {string} [tz='Europe/London'] - Household timezone for time formatting
 * @returns {string}
 */
/**
 * Build the daily-reminder content as discrete parts so it can be plugged
 * into a Twilio Content Template (one variable per part) instead of being
 * shipped as a freeform string. Returns:
 *   {
 *     name: string,       // user's display name (or "there")
 *     greeting: string,   // "Good morning" / "Good afternoon" / "Good evening"
 *     weekday: string,    // "Tuesday" - localised to household tz
 *     body: string,       // multi-line: weather + schedule + reminders + …
 *   }
 *
 * The legacy buildDailyReminderMessage() composes these parts into the
 * exact single-string layout it always produced, so tests + non-template
 * fallback senders are unaffected.
 */
function buildDailyReminderParts(user, opts = {}) {
  const {
    todayEvents = [],
    shoppingCount = 0,
    schoolActivities = [],
    tz = 'Europe/London',
    linkedAt = null,
    weatherLine = null,
    dinner = null,             // { meal_name, cook_time_mins }
    taskReminders = [],        // [{ title, when: "today"|"tomorrow" }]
    billReminders = [],        // [{ name, when: "today"|"tomorrow" }]
  } = opts;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Weekday in the household's local timezone so a digest fired at
  // 07:00 BST says "Thursday" even when the server clock is UTC.
  let weekday = '';
  try {
    weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: tz });
  } catch { /* leave blank if tz is invalid */ }

  const lines = [];

  // Weather one-liner - null on quiet days so we don't pad with filler.
  if (weatherLine) {
    lines.push(weatherLine);
    lines.push('');
  }

  // Kids Activities (term-time filtered upstream). No bullets per the
  // redesign - prose-like lines under a single heading.
  if (schoolActivities && schoolActivities.length > 0) {
    lines.push('🏫 Kids Activities:');
    for (const act of schoolActivities) {
      const timeStr = act.time_end ? ` until ${act.time_end.substring(0, 5)}` : '';
      const note = act.reminder_text ? ` (${act.reminder_text})` : '';
      lines.push(`${act.child_name} - ${act.activity}${timeStr}${note}`);
    }
    lines.push('');
  }

  // Today's Schedule - both all-day and timed events. All-day events
  // render first (they bracket the whole day) labelled "All day -",
  // then timed events in chronological order.
  const eventsArr = Array.isArray(todayEvents) ? todayEvents : [];
  const allDayEvents = eventsArr.filter(e => e.all_day);
  const timedEvents = eventsArr.filter(e => !e.all_day);
  if (allDayEvents.length > 0 || timedEvents.length > 0) {
    lines.push("📅 Today's Schedule:");
    for (const ev of allDayEvents) {
      const who = formatEventAssignee(ev);
      lines.push(`All day - ${ev.title}${who ? ` _(${who})_` : ''}`);
    }
    for (const ev of timedEvents) {
      const startStr = formatEventTime(ev.start_time, tz);
      const who = formatEventAssignee(ev);
      lines.push(`${startStr} - ${ev.title}${who ? ` _(${who})_` : ''}`);
    }
    lines.push('');
  }

  // "Nothing scheduled" only when BOTH kids activities and the events
  // list are empty. Bills/tasks/meals don't count as schedule items.
  const hasSchool = Array.isArray(schoolActivities) && schoolActivities.length > 0;
  if (!hasSchool && eventsArr.length === 0) {
    lines.push('✨ Nothing scheduled today.');
    lines.push('');
  }

  // Today's dinner from the meal plan. Cook time is included when the
  // recipe has it; otherwise just the meal name.
  if (dinner && dinner.meal_name) {
    const cookTime = dinner.cook_time_mins ? ` - ${dinner.cook_time_mins} min` : '';
    lines.push(`🍽️ Dinner: ${dinner.meal_name}${cookTime}`);
    lines.push('');
  }

  // Reminders block - the ONE bulleted section in the digest per the
  // redesign. Combines tasks due today/tomorrow + subscription bills
  // renewing today/tomorrow into a single actionable list.
  const reminderLines = [];
  for (const t of taskReminders) {
    reminderLines.push(`• ${t.title} due ${t.when}`);
  }
  for (const b of billReminders) {
    reminderLines.push(`• ${b.name} due ${b.when}`);
  }
  if (reminderLines.length > 0) {
    lines.push('📋 Reminders:');
    lines.push(...reminderLines);
    lines.push('');
  }

  // Shopping summary - one line, no bullets.
  if (shoppingCount > 0) {
    lines.push(`🛒 ${shoppingCount} item${shoppingCount !== 1 ? 's' : ''} on the shopping list.`);
  }

  // Discovery footer - rotates through "💡 Did you know…" tips for
  // the first 14 days post-WhatsApp-link, then settles into a quiet
  // "_Reply /help for all commands._" line.
  lines.push('');
  lines.push(pickDigestFooter(linkedAt));

  const body = lines.join('\n').trim();
  return { name: user.name || 'there', greeting, weekday, body };
}

/**
 * Build the seven single-line variables for the Twilio Content Template
 * `housemait_morning_brief_v2`. WhatsApp / Twilio rejects variable
 * values containing newlines, tabs, or 4+ consecutive whitespace chars
 * (error 21656), and empty strings are forbidden too - so every var
 * here is guaranteed non-empty single-line content.
 *
 * Template body baked into Twilio Content Builder:
 *   Good morning, {{1}}! Here's your {{2}}.
 *
 *   {{3}}
 *
 *   📅 Today's Schedule:
 *   {{4}}
 *
 *   📋 Reminders:
 *   {{5}}
 *
 *   🛒 {{6}}
 *
 *   💡 {{7}}
 *
 *   Open Housemait or reply to this message to manage anything.
 *
 * Variable shapes:
 *   {{1}} first name        e.g. "Grant"
 *   {{2}} weekday           e.g. "Tuesday"
 *   {{3}} weather one-liner e.g. "18°C, light rain later in London"
 *   {{4}} events            comma-separated  "14:00 - Dentist · 15:30 - Logan pickup (Sarah)"
 *   {{5}} reminders         comma-separated  "Buy birthday card due today"
 *   {{6}} shopping          e.g. "5 items on the shopping list"
 *   {{7}} footer            dinner plan / rotating tip
 */
function buildDailyReminderTemplateVars(user, opts = {}) {
  const {
    todayEvents = [],
    shoppingCount = 0,
    schoolActivities = [],
    tz = 'Europe/London',
    linkedAt = null,
    weatherLine = null,
    dinner = null,
    taskReminders = [],
    billReminders = [],
  } = opts;

  // First name only - the template greeting "Good morning, {{1}}!" reads
  // weirdly with a full name, and Meta's reviewers used the first-name
  // sample we supplied.
  const firstName = (user.name || 'there').trim().split(/\s+/)[0] || 'there';

  // Weekday in the household tz so a 07:00 BST send says "Thursday"
  // even when the server clock is UTC.
  let weekday = 'today';
  try {
    weekday = new Date().toLocaleDateString('en-GB', { weekday: 'long', timeZone: tz });
  } catch { /* fallback already set */ }

  // ── single-line sanitiser ──────────────────────────────────────────
  // Collapse any whitespace run (newlines, tabs, doubled spaces) into a
  // single space. Strip leading/trailing whitespace. Strip the freeform-
  // markdown emphasis (*bold*, _italic_) we use in WhatsApp text - it's
  // pointless inside a template variable and would render as literal
  // asterisks in the wrapped output.
  const oneLine = (s) => String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[*_]([^*_]+)[*_]/g, '$1')
    .trim();

  // {{3}} weather - one-liner from the upstream service.
  const weather = oneLine(weatherLine) || 'Weather unavailable for today';

  // {{4}} events - all-day first, then timed, then school activities,
  // joined by " · " (middle dot + spaces - reads as bullets in WA).
  const allDay = (todayEvents || []).filter(e => e.all_day);
  const timed = (todayEvents || []).filter(e => !e.all_day);
  const eventStrings = [
    ...allDay.map(e => {
      const who = formatEventAssignee(e);
      return `All day - ${e.title}${who ? ` (${who})` : ''}`;
    }),
    ...timed.map(e => {
      const t = formatEventTime(e.start_time, tz);
      const who = formatEventAssignee(e);
      return `${t} - ${e.title}${who ? ` (${who})` : ''}`;
    }),
    ...(schoolActivities || []).map(a => {
      const timeStr = a.time_end ? ` until ${a.time_end.substring(0, 5)}` : '';
      return `${a.child_name} - ${a.activity}${timeStr}`;
    }),
  ];
  const events = eventStrings.length > 0
    ? oneLine(eventStrings.join(' · '))
    : 'Nothing scheduled today';

  // {{5}} reminders - tasks + bills joined by " · ".
  const reminderStrings = [
    ...(taskReminders || []).map(t => `${t.title} due ${t.when}`),
    ...(billReminders || []).map(b => `${b.name} due ${b.when}`),
  ];
  const reminders = reminderStrings.length > 0
    ? oneLine(reminderStrings.join(' · '))
    : 'Nothing due today';

  // {{6}} shopping - the count phrase that previously sat in the body.
  const shopping = shoppingCount > 0
    ? `${shoppingCount} item${shoppingCount !== 1 ? 's' : ''} on the shopping list`
    : 'Shopping list is empty';

  // {{7}} footer - prefer the dinner plan when there is one (the most
  // actionable line in the digest), otherwise fall back to a rotating
  // discovery tip so the var is never empty.
  //
  // The template body wraps {{7}} with a static "💡 " prefix, and
  // pickDigestFooter() returns "💡 Did you know:..." strings ready for
  // the freeform path which has no template wrapper. Inside the
  // template we need to strip that leading emoji + space, otherwise
  // it renders as "💡 💡 Did you know..." (the static + dynamic bulb
  // colliding). Same applies to any other leading-glyph footer that
  // pickDigestFooter may emit in the future.
  let footer;
  if (dinner && dinner.meal_name) {
    const cookTime = dinner.cook_time_mins ? ` - ${dinner.cook_time_mins} min` : '';
    footer = `Tonight's dinner: ${dinner.meal_name}${cookTime}`;
  } else {
    // pickDigestFooter returns a multi-segment string; collapse it.
    footer = oneLine(pickDigestFooter(linkedAt)) || 'Reply /help for all commands';
  }
  // Strip a leading emoji + whitespace so the template's static glyph
  // isn't duplicated. Range covers WhatsApp's common pictographs incl.
  // 💡 (U+1F4A1), 🍽️ (U+1F37D + VS16), etc.
  footer = footer.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}](?:️)?\s*/u, '');

  return {
    '1': firstName,
    '2': weekday,
    '3': weather,
    '4': events,
    '5': reminders,
    '6': shopping,
    '7': footer,
  };
}

/**
 * Legacy single-string daily reminder, produced by composing parts into
 * the exact layout we shipped before the Content-Template work. Keeps
 * the freeform-fallback path identical and tests passing.
 */
function buildDailyReminderMessage(user, opts = {}) {
  const { name, greeting, weekday, body } = buildDailyReminderParts(user, opts);
  const opener = weekday
    ? `${greeting}, ${name}! Here's your ${weekday}:`
    : `${greeting}, ${name}! Here's what's on for today:`;
  return body ? `${opener}\n\n${body}` : opener;
}

/**
 * Fetch today's events for a household, filtered the same way the
 * Dashboard / digest endpoint does: drop public_holiday + birthday
 * categories (they're noise in a "what's on today" context), dedupe
 * on (title, start_time) since calendar sync can produce duplicates,
 * and sort by start_time.
 */
async function fetchTodayEvents(householdId, todayStr) {
  const windowStart = `${todayStr}T00:00:00`;
  const windowEnd = `${todayStr}T23:59:59`;
  let events = [];
  try {
    events = await db.getCalendarEvents(householdId, windowStart, windowEnd) || [];
  } catch (e) {
    console.warn('[reminders] events fetch failed:', e.message);
    return [];
  }
  const filtered = events.filter(e => {
    const start = e.start_time?.split('T')[0];
    const end = e.end_time?.split('T')[0];
    const isToday = start === todayStr || (start <= todayStr && (end || todayStr) >= todayStr);
    return isToday && e.category !== 'public_holiday' && e.category !== 'birthday';
  });
  const seen = new Set();
  return filtered
    .filter(e => {
      const key = `${e.title}|${e.start_time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
}

/**
 * Send daily reminder to a specific member, or all connected members of a household.
 *
 * @param {string} householdId
 * @param {object} [singleMember] - If provided, only send to this member
 * @param {object} [options]
 * @param {boolean} [options.ignoreOptOut] - send even if the member has
 *   turned the brief off (used by the admin "send to me now" preview)
 */
async function sendDailyReminders(householdId, singleMember, options = {}) {
  const today = new Date().toISOString().split('T')[0];

  // Fetch household for timezone (used to render event times in the
  // user's local clock rather than UTC).
  const household = await db.getHouseholdById(householdId).catch(() => null);
  const tz = household?.timezone || 'Europe/London';

  const shoppingItems = await db.getShoppingList(householdId);
  const shoppingCount = shoppingItems.length;

  // Today's calendar events - same scope across all recipients in the
  // household (events are household-wide, not per-member).
  const todayEvents = await fetchTodayEvents(householdId, today);

  // Today's dinner from the meal plan. Pulls just the current date and
  // picks the first dinner-category row; joined recipes give us
  // cook_time_mins for the digest line. Soft-fail so a meal lookup
  // hiccup never blocks the digest.
  let dinner = null;
  try {
    const meals = await db.getMealPlanForWeek(householdId, today, today);
    const dinnerRow = (meals || []).find(m => m.category === 'dinner');
    if (dinnerRow) {
      dinner = {
        meal_name: dinnerRow.meal_name || dinnerRow.recipes?.name || null,
        cook_time_mins: dinnerRow.recipes?.cook_time_mins || null,
      };
    }
  } catch (e) {
    console.warn('[reminders] meal fetch failed:', e.message);
  }

  // Tomorrow's date in the household's tz for the reminders window.
  const tomorrow = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  // Tasks due today or tomorrow → reminder lines. Pulled once per
  // household run since tasks are household-scoped (we surface them to
  // every recipient; per-assignee filtering could be a follow-up).
  let taskReminders = [];
  try {
    const allTasks = await db.getAllIncompleteTasks(householdId);
    taskReminders = (allTasks || [])
      .filter(t => t.due_date === today || t.due_date === tomorrow)
      .map(t => ({
        title: t.title,
        when: t.due_date === today ? 'today' : 'tomorrow',
      }));
  } catch (e) {
    console.warn('[reminders] task fetch failed:', e.message);
  }

  // Subscription bills renewing today or tomorrow → reminder lines.
  // listSubscriptions is the household-scoped query (the
  // -RenewingBetween variant misses the household filter).
  let billReminders = [];
  try {
    const subs = await db.listSubscriptions(householdId);
    billReminders = (subs || [])
      .filter(s => {
        if (!s.next_renewal_at) return false;
        const renewYmd = String(s.next_renewal_at).slice(0, 10);
        return renewYmd === today || renewYmd === tomorrow;
      })
      .map(s => ({
        name: s.name,
        when: String(s.next_renewal_at).slice(0, 10) === today ? 'today' : 'tomorrow',
      }));
  } catch (e) {
    console.warn('[reminders] subscription fetch failed:', e.message);
  }

  // Today's weather one-liner - one fetch per household run, shared
  // across every member's digest. Cached 12h inside the helper so a
  // re-trigger / second cron tick doesn't re-fetch.
  let weatherLine = null;
  try {
    const forecast = await fetchTodayForecastForHousehold(household);
    weatherLine = buildDigestWeatherLine(forecast);
  } catch (e) {
    console.warn('[reminders] weather fetch failed:', e.message);
  }

  const targets = singleMember ? [singleMember] : await db.getHouseholdMembers(householdId);

  for (const member of targets) {
    // Per-user opt-out (Settings → Notifications). whatsapp_daily_reminder is
    // the channel-agnostic master switch for the morning brief: default true
    // (a null row, missing column, or any non-false value all mean "send");
    // only an explicit false turns it off.
    const prefs = await db.getNotificationPreferences(member.id).catch(() => null);
    const briefDisabled = !options.ignoreOptOut && !!(prefs && prefs.whatsapp_daily_reminder === false);
    const whatsappLinked = !!(member.whatsapp_linked && member.whatsapp_phone);

    // App installed? = has ≥1 active push device token. App users get the
    // richer push brief; everyone else falls back to the WhatsApp digest.
    let deviceTokens = [];
    try { deviceTokens = (await db.getActiveDeviceTokens(member.id)) || []; } catch { deviceTokens = []; }
    const hasDevices = deviceTokens.length > 0;

    const channel = chooseDailyBriefChannel({ hasDevices, whatsappLinked, briefDisabled });
    if (!channel) {
      console.log(`[reminders] Skipping ${member.name} - no channel (devices=${hasDevices}, whatsapp=${whatsappLinked}, disabled=${briefDisabled})`);
      continue;
    }

    // Get today's school activities for children in this household
    // Only include if today is during term time (not holidays, half term, INSET, or bank holiday)
    const schoolActivities = [];
    try {
      const dayOfWeek = (new Date().getDay() + 6) % 7; // Convert JS day (0=Sun) to our format (0=Mon)
      if (dayOfWeek <= 4) { // Only Mon-Fri
        const todayStr = new Date().toISOString().split('T')[0];
        const allMembers = await db.getHouseholdMembers(householdId);
        const dependents = allMembers.filter(m => m.member_type === 'dependent');
        const householdSchools = await db.getHouseholdSchools(householdId).catch(() => []);

        for (const child of dependents) {
          // Resolve which school's term calendar applies to this child (their
          // own school_id, or the household's single school). Only gate on
          // term-in-session when a school resolves; with no school the activity's
          // own term window is the only gate.
          const { isSchoolInSession, activityActiveOn, resolveTermSchoolForChild } = require('../utils/school-terms');
          const termSchoolId = resolveTermSchoolForChild(child, householdSchools);
          if (termSchoolId && !(await isSchoolInSession(termSchoolId, todayStr))) continue; // school holiday/inset/half-term

          const activities = await db.getChildActivities(child.id);
          // Honour the activity's term window (today inside [start_date,
          // end_date], NULL dates = ongoing) and per-date skips ("no
          // swimming today" must keep it out of the morning brief too).
          const todayActivities = activities.filter(a =>
            a.day_of_week === dayOfWeek && a.term_only !== false && activityActiveOn(a, todayStr)
            && !(a.skips || []).includes(todayStr));
          for (const act of todayActivities) {
            // Per-date override: the brief must show today's one-off
            // time/pickup, not the series values.
            const ov = act.overrides?.[todayStr];
            schoolActivities.push(ov
              ? { ...act, time_start: ov.time_start, time_end: ov.time_end, pickup_member_id: ov.pickup_member_id, child_name: child.name }
              : { ...act, child_name: child.name });
          }
        }
      }
    } catch { /* silently skip school activities on error */ }

    const buildOpts = {
      todayEvents,
      shoppingCount,
      schoolActivities,
      tz,
      linkedAt: member.whatsapp_linked_at || null,
      weatherLine,
      dinner,
      taskReminders,
      billReminders,
    };
    // ── Push channel (app installed): warm, LLM-generated copy that varies
    // each day, free of WhatsApp's rigid template rules. Reuses the exact
    // same digest data (parts.body) as the source, rewritten conversationally.
    if (channel === 'push') {
      const parts = buildDailyReminderParts(member, buildOpts);
      const { title, body } = await generateMorningBriefPush(
        {
          name: parts.name,
          weekday: parts.weekday,
          summary: parts.body,
          counts: {
            eventCount: todayEvents.length,
            taskCount: taskReminders.length,
            billCount: billReminders.length,
          },
        },
        { householdId, userId: member.id },
      );
      try {
        const result = await push.sendPushNotification(
          deviceTokens.map((t) => t.token),
          { title, body, data: { type: 'morning_brief' } },
        );
        console.log(`[reminders] Morning brief push → ${member.name}: sent=${result.sent} failed=${result.failed}`);
      } catch (err) {
        console.error(`Failed to send morning brief push to ${member.name}:`, err.message);
      }
      continue;
    }

    // ── WhatsApp channel (no app installed): the legacy digest ──
    const message = buildDailyReminderMessage(member, buildOpts);

    // Send via WhatsApp. Prefer the approved Content Template path when
    // TWILIO_TEMPLATE_DAILY_REMINDER is set - that's what gets through
    // WhatsApp's 24-hour customer-service window. The freeform path is
    // kept as a fallback so local dev / un-approved deploys still send
    // something (even if it'll be silently dropped outside the window
    // by Twilio with error 63016).
    //
    // The approved morning-brief-v2 template uses SEVEN single-line
    // variables - each cell of the digest is one variable, so the
    // structure (newlines, section headings, emoji glyphs) lives in
    // the static template body rather than in any variable value.
    // This sidesteps Twilio's variable-content restrictions (no
    // newlines / no 4+ consecutive whitespace / no empty strings - any
    // of which trigger error 21656).
    //
    //   {{1}} first name           {{2}} weekday
    //   {{3}} weather one-liner    {{4}} events summary
    //   {{5}} reminders summary    {{6}} shopping count
    //   {{7}} dinner / rotating tip
    //
    // The full multi-line message string is still used for the freeform
    // fallback below - we only flatten to single-line per-section when
    // the template path is in play.
    if (whatsapp.isConfigured()) {
      const templateSid = process.env.TWILIO_TEMPLATE_DAILY_REMINDER;
      const contentVars = buildDailyReminderTemplateVars(member, buildOpts);

      try {
        if (templateSid) {
          await whatsapp.sendTemplate(member.whatsapp_phone, templateSid, contentVars);
        } else {
          // Legacy freeform path - sendTemplate falls through to
          // sendMessage when the second arg isn't a Content SID.
          await whatsapp.sendTemplate(member.whatsapp_phone, message);
        }
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
      console.log(`[reminders] Skipping ${member.name} - whatsapp service not configured`);
    }
  }
}

module.exports = {
  buildDailyReminderMessage,
  buildDailyReminderParts,
  buildDailyReminderTemplateVars,
  chooseDailyBriefChannel,
  sendDailyReminders,
};
