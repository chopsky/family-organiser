const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const push = require('../services/push');
const assistantMeter = require('../services/assistant-meter');
const { generateMorningBriefPush } = require('../services/morning-brief');
const { pickDigestFooter } = require('../utils/whatsapp-tips');
const conflicts = require('../services/conflicts');
const { buildDigestWeatherLine } = require('../utils/weather-line');
const { fetchTodayForecastForHousehold } = require('../services/digest-weather');

/**
 * WhatsApp engagement state for brief routing (activation redesign,
 * 2026-07-20). Chat-list position is attention: a WhatsApp brief re-ranks
 * Housemait to the top of the user's chats every morning, which push can
 * never do - so WhatsApp wins while the habit is forming or alive, and
 * retires when the user has plainly ignored it (cost + block-risk live
 * almost entirely in messaging the long-silent).
 *
 *   'active'  - inbound message in the last 14 days. Their home surface,
 *               and usually FREE (their replies keep the 24h window open).
 *   'new'     - linked <30 days, not (yet) active. The habit-formation
 *               window; WhatsApp carries content-full briefs.
 *   'lapsed'  - was active, quiet 14-30 days. Taper, not cliff.
 *   'dormant' - 30+ days without a real inbound message. One sign-off,
 *               then push-only; any inbound flips straight back to active.
 *
 * The pairing flow itself produces one inbound message ("Link 482913"), so
 * inbound within 15 minutes of linking doesn't count as engagement.
 */
const BRIEF_ENGAGEMENT_GRACE_MS = 15 * 60 * 1000;
function whatsappBriefState(member, nowMs = Date.now()) {
  const linkedMs = new Date(member?.whatsapp_linked_at || 0).getTime();
  if (!Number.isFinite(linkedMs) || !linkedMs) return null;
  const inboundMs = new Date(member?.whatsapp_last_inbound_at || 0).getTime();
  const engagedInbound = Number.isFinite(inboundMs) && inboundMs - linkedMs > BRIEF_ENGAGEMENT_GRACE_MS
    ? inboundMs
    : null;
  const DAY = 24 * 60 * 60 * 1000;
  const daysSinceInbound = engagedInbound ? (nowMs - engagedInbound) / DAY : Infinity;
  const daysSinceLinked = (nowMs - linkedMs) / DAY;
  if (daysSinceInbound <= 14) return 'active';
  if (daysSinceLinked <= 30) return 'new';
  if (daysSinceInbound <= 30) return 'lapsed';
  return 'dormant';
}

/**
 * Pick the delivery channel for a member's morning brief.
 *
 * With a WhatsApp state supplied (the daily cron always supplies one for
 * linked members):
 *   - active  → whatsapp always (content or not - the ritual is theirs)
 *   - new     → whatsapp on content days; a contentless brief is NEVER sent
 *               to someone who's never replied (that's the block generator -
 *               the capture openers carry their quiet days instead), so
 *               content-free days fall back to push/skip
 *   - lapsed  → whatsapp on content days, push on quiet days
 *   - dormant → push only (the one-time sign-off is handled by the caller)
 * Without a state (member not linked, or legacy callers): push if the app
 * is installed, else whatsapp if linked, else skip - the old behaviour.
 *
 * @param {object} p
 * @param {boolean} p.hasDevices     - member has ≥1 active push device token
 * @param {boolean} p.whatsappLinked - member has WhatsApp linked + a phone
 * @param {boolean} p.briefDisabled  - member opted out of the daily brief
 * @param {'active'|'new'|'lapsed'|'dormant'|null} [p.waState]
 * @param {boolean} [p.hasContent]   - brief carries real schedule/dinner/
 *                                     reminder content (weather/tips aside)
 * @returns {'push'|'whatsapp'|null}
 */
function chooseDailyBriefChannel({ hasDevices, whatsappLinked, briefDisabled, waState, hasContent }) {
  if (briefDisabled) return null;
  if (whatsappLinked && waState) {
    if (waState === 'active') return 'whatsapp';
    if (waState === 'new' || waState === 'lapsed') {
      if (hasContent) return 'whatsapp';
      return hasDevices ? 'push' : null;
    }
    // dormant
    return hasDevices ? 'push' : null;
  }
  if (hasDevices) return 'push';
  if (whatsappLinked) return 'whatsapp';
  return null;
}

/** The WhatsApp engagement state a brief variant should route on. The
 *  evening brief is opt-in, so 'dormant' is coerced to 'active' - dormancy
 *  must neither silence nor reroute something the user explicitly asked
 *  for. Every other state passes through untouched: nulling the whole state
 *  (the previous approach) skipped the chooser's entire WhatsApp branch and
 *  pushed the evening brief at WhatsApp-ACTIVE app owners too, splitting
 *  their briefs across channels (real report 2026-08-05). */
function effectiveBriefWaState(variant, waState) {
  return variant === 'evening' && waState === 'dormant' ? 'active' : waState;
}

/** Shift a YYYY-MM-DD date string by n days. UTC arithmetic on a date-only
 *  string - no timezone drift, because there is no time-of-day to drift. */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
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
    clashLines = [],           // "⚠️ X double-booked: …" lines, prebuilt per household
    tz = 'Europe/London',
    linkedAt = null,
    weatherLine = null,
    dinner = null,             // { meal_name, cook_time_mins }
    taskReminders = [],        // [{ title, when: "today"|"tomorrow" }]
    billReminders = [],        // [{ name, when: "today"|"tomorrow" }]
    // 'morning' (07:00, about today) or 'evening' (20:00, about tomorrow).
    // The evening variant exists because people who leave early were seeing
    // the morning brief after they'd already gone.
    variant = 'morning',
    // The day the brief is ABOUT, as YYYY-MM-DD. Defaults to today so every
    // existing caller is byte-identical; the evening job passes tomorrow.
    anchorDate = null,
  } = opts;

  const isEvening = variant === 'evening';
  const day = isEvening ? 'tomorrow' : 'today';

  const hour = new Date().getHours();
  const greeting = isEvening
    ? 'Evening'
    : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Weekday of the day the brief is ABOUT, in the household's local timezone,
  // so a digest fired at 07:00 BST says "Thursday" even when the server clock
  // is UTC - and an evening brief names tomorrow, not tonight.
  let weekday = '';
  try {
    const d = anchorDate ? new Date(`${anchorDate}T12:00:00Z`) : new Date();
    weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: anchorDate ? 'UTC' : tz });
  } catch { /* leave blank if tz is invalid */ }

  // The schedule heading carries the weekday in the evening ("Thursday's
  // Schedule"), which lets the opener stay a plain, warm "here's how tomorrow's
  // looking" instead of cramming the day into a parenthesis after it.
  const Day = isEvening ? (weekday || 'Tomorrow') : 'Today';

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
    lines.push(`📅 ${Day}'s Schedule:`);
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

  // Double-bookings, right under the schedule they refer to. Prebuilt per
  // household (same-person overlap only - see services/conflicts.js).
  if (Array.isArray(clashLines) && clashLines.length > 0) {
    for (const l of clashLines) lines.push(l);
    lines.push('');
  }

  // "Nothing scheduled" only when BOTH kids activities and the events
  // list are empty. Bills/tasks/meals don't count as schedule items.
  const hasSchool = Array.isArray(schoolActivities) && schoolActivities.length > 0;
  if (!hasSchool && eventsArr.length === 0) {
    lines.push(`✨ Nothing scheduled ${day}.`);
    // Quiet days still earn their place: an empty brief must invite a reply,
    // not read as "this app does nothing".
    lines.push('Anything I should add? Just tell me - "dentist Thursday 2pm" is all it takes.');
    lines.push('');
  }

  // Today's dinner from the meal plan. Cook time is included when the
  // recipe has it; otherwise just the meal name.
  // Evening deliberately carries NO dinner and NO shopping line. The night-
  // before message is a heads-up about what's HAPPENING - domestic admin makes
  // it longer without making it more useful at 8pm, and both are already in
  // the morning brief.
  if (!isEvening && dinner && dinner.meal_name) {
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

  // Shopping summary - one line, no bullets. Morning only (see above).
  if (!isEvening && shoppingCount > 0) {
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
    clashLines = [],
    tz = 'Europe/London',
    linkedAt = null,
    weatherLine = null,
    dinner = null,
    taskReminders = [],
    billReminders = [],
    variant = 'morning',
    anchorDate = null,
  } = opts;

  const isEvening = variant === 'evening';
  const day = isEvening ? 'tomorrow' : 'today';

  // First name only - the template greeting "Good morning, {{1}}!" reads
  // weirdly with a full name, and Meta's reviewers used the first-name
  // sample we supplied.
  const firstName = (user.name || 'there').trim().split(/\s+/)[0] || 'there';

  // Weekday of the day the brief is ABOUT, in the household tz, so a 07:00
  // BST send says "Thursday" even when the server clock is UTC.
  let weekday = day;
  try {
    const d = anchorDate ? new Date(`${anchorDate}T12:00:00Z`) : new Date();
    weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: anchorDate ? 'UTC' : tz });
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
  const weather = oneLine(weatherLine) || `Weather unavailable for ${day}`;

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
    // Double-bookings ride the events var - the template has no spare slot,
    // and they belong beside the schedule anyway.
    ...(Array.isArray(clashLines) ? clashLines.map(oneLine) : []),
  ];
  const events = eventStrings.length > 0
    ? oneLine(eventStrings.join(' · '))
    : `Nothing scheduled ${day}`;

  // {{5}} reminders - tasks + bills joined by " · ".
  const reminderStrings = [
    ...(taskReminders || []).map(t => `${t.title} due ${t.when}`),
    ...(billReminders || []).map(b => `${b.name} due ${b.when}`),
  ];
  const reminders = reminderStrings.length > 0
    ? oneLine(reminderStrings.join(' · '))
    : `Nothing due ${day}`;

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
  if (!isEvening && dinner && dinner.meal_name) {
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

  // The evening template is SIX variables, not seven: no shopping count, and
  // no dinner (so {{6}} is always the rotating tip). Dropping a variable means
  // renumbering rather than sending an empty one - Twilio rejects empty
  // variable values outright (error 21656).
  if (isEvening) {
    // Weather is {{2}} and the weekday {{3}} - the reverse of the morning
    // template - because WhatsApp requires variables to appear in ASCENDING
    // order in the body, and the evening layout puts the weather line above
    // the schedule heading. Numbering them by meaning instead of by position
    // (1, 3, 2, …) is what got housemait_evening_brief_v1 rejected.
    return {
      '1': firstName,
      '2': weather,
      '3': weekday,
      '4': events,
      '5': reminders,
      '6': footer,
    };
  }

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
  const isEvening = opts.variant === 'evening';
  // The evening opener says TOMORROW and nothing else - "Here's your Thursday"
  // sent at 8pm on Wednesday reads as though it's about the day just ending,
  // and bracketing the weekday after it ("tomorrow (Thursday)") reads like a
  // database field. The weekday appears a line later, in the schedule heading.
  const opener = isEvening
    ? `${greeting}, ${name}! Here's how tomorrow's looking:`
    : (weekday
      ? `${greeting}, ${name}! Here's your ${weekday}:`
      : `${greeting}, ${name}! Here's what's on for today:`);
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
 * @param {'morning'|'evening'} [options.variant='morning'] - 'evening' builds
 *   the same brief about TOMORROW, for people who are out of the house before
 *   the 07:00 one lands.
 * @param {'push'|'whatsapp'} [options.forceChannel] - admin self-preview only.
 *   Skips the channel decision so the WhatsApp copy can be checked from a
 *   phone that has the app installed (where push would otherwise always win).
 *   The cron never sets this.
 */
/**
 * Ask - once, ever - whether they'd also like the night-before brief.
 *
 * Rides their FIRST morning brief rather than the pairing sequence. At
 * pairing you're asking someone to picture a message they've never seen; here
 * they've just read one, so "want this twelve hours earlier?" is concrete.
 *
 * It also self-selects: the brief router withholds content-free briefs from
 * people who've never replied, so a household with nothing in it never gets a
 * brief and so never gets asked - which is right, because an evening brief
 * would be no more use to them than the morning one.
 *
 * Freeform is fine immediately after the template: the template send opens a
 * 24-hour window. Best-effort throughout - a failed offer must never mark the
 * brief itself as failed.
 */
async function offerEveningBriefOnce(member, variant) {
  if (variant === 'evening') return;
  if (!member?.id || !member.whatsapp_phone) return;
  try {
    const prefs = await db.getNotificationPreferences(member.id);
    if (prefs?.evening_brief) return;                       // already on
    if (await db.hasEveningBriefOfferBeenSent(member.id)) return;

    // Required lazily: the offer copy lives next to the branch that handles
    // the reply, and bot/handlers is a heavy module this job otherwise
    // doesn't need.
    const { EVENING_BRIEF_OFFER_MESSAGE } = require('../bot/handlers');
    await whatsapp.sendMessage(member.whatsapp_phone, EVENING_BRIEF_OFFER_MESSAGE);
    // Stamp only after the send succeeds, so a Twilio blip doesn't burn the
    // one chance we get to ask.
    await db.stampEveningBriefOfferSent(member.id);
  } catch (err) {
    console.error(`[reminders] evening-brief offer to ${member.name} failed:`, err.message);
  }
}

async function sendDailyReminders(householdId, singleMember, options = {}) {
  const variant = options.variant === 'evening' ? 'evening' : 'morning';
  const realToday = new Date().toISOString().split('T')[0];
  // The day the brief is ABOUT. Everything below hangs off this rather than
  // "now", which is the whole trick: the evening brief is the same brief
  // pointed one day forward.
  const today = variant === 'evening' ? addDays(realToday, 1) : realToday;

  // Fetch household for timezone (used to render event times in the
  // user's local clock rather than UTC).
  const household = await db.getHouseholdById(householdId).catch(() => null);
  const tz = household?.timezone || 'Europe/London';

  // FREE_APP_MODE: briefs are premium. A lapsed household gets ONE
  // farewell (a push - the WhatsApp-side announcement is the lapse
  // template's job, and an out-of-window free-form send would bounce
  // anyway), then this job goes quiet for them until they resubscribe.
  if (assistantMeter.isMeteredHousehold(household)) {
    if (!household.farewell_brief_sent_at) {
      try {
        await push.sendToHousehold(householdId, null, {
          title: 'My last daily brief',
          body: `Your trial has ended - the app stays free for your family, and daily briefs are part of Premium. I'm still here for ${assistantMeter.FREE_MONTHLY_ACTIONS} free AI uses a month.`,
          data: { type: 'farewell_brief' },
        });
      } catch (err) {
        console.warn('[reminders] farewell brief push failed:', err.message);
      }
      db.markFarewellBriefSent(householdId).catch(() => {});
    }
    return;
  }

  const shoppingItems = await db.getShoppingList(householdId);
  const shoppingCount = shoppingItems.length;

  // Calendar events for the anchor day - same scope across all recipients in
  // the household (events are household-wide, not per-member).
  const todayEvents = await fetchTodayEvents(householdId, today);

  // The anchor day's dinner from the meal plan. Pulls just that date and
  // picks the first dinner-category row; joined recipes give us
  // cook_time_mins for the digest line. Soft-fail so a meal lookup
  // hiccup never blocks the digest.
  // Morning only - the evening brief doesn't print the dinner, so don't ask
  // the database for it.
  let dinner = null;
  try {
    const meals = variant === 'evening'
      ? []
      : await db.getMealPlanForWeek(householdId, today, today);
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

  // The day after the anchor, for the reminders window.
  const tomorrow = addDays(today, 1);

  // How to NAME the two days in a reminder line. In the morning that's
  // today/tomorrow. In the evening the anchor day IS tomorrow, so labelling it
  // "today" - which is what comparing against the anchor produced - told
  // someone at 8pm that a form was due the day that had just ended. The day
  // after the anchor gets its weekday name; "the day after tomorrow" is a
  // mouthful nobody says.
  const whenLabel = (ymd) => {
    if (variant === 'evening') {
      if (ymd === today) return 'tomorrow';
      try {
        return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      } catch { return 'soon'; }
    }
    return ymd === today ? 'today' : 'tomorrow';
  };

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
        when: whenLabel(t.due_date),
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
        when: whenLabel(String(s.next_renewal_at).slice(0, 10)),
      }));
  } catch (e) {
    console.warn('[reminders] subscription fetch failed:', e.message);
  }

  // Load the household roster once - reused for the weather location (any
  // member's shared device location), the send targets, and the school-
  // activity dependents below.
  const householdMembers = await db.getHouseholdMembers(householdId).catch(() => []);

  // Same-person double-bookings on the anchor day - one probe per household,
  // shared across every recipient (conflicts are household facts, like the
  // events themselves). Garnish by design: any failure yields no lines.
  let clashLines = [];
  try {
    const { pairs } = await conflicts.findConflictsForDate(householdId, today, {
      members: householdMembers, timezone: tz,
    });
    clashLines = conflicts.briefConflictLines(pairs, tz);
  } catch { clashLines = []; }

  // Today's weather one-liner - one fetch per household run, shared
  // across every member's digest. Cached 12h inside the helper so a
  // re-trigger / second cron tick doesn't re-fetch. Location precedence:
  // a fresh shared device location → typed home address → stale shared
  // location → omit.
  let weatherLine = null;
  try {
    const forecast = await fetchTodayForecastForHousehold(household, householdMembers, {
      dayOffset: variant === 'evening' ? 1 : 0,
    });
    weatherLine = buildDigestWeatherLine(forecast);
  } catch (e) {
    console.warn('[reminders] weather fetch failed:', e.message);
  }

  const targets = singleMember ? [singleMember] : householdMembers;

  for (const member of targets) {
    // Per-user opt-out (Settings → Notifications). whatsapp_daily_reminder is
    // the channel-agnostic master switch for the morning brief: default true
    // (a null row, missing column, or any non-false value all mean "send");
    // only an explicit false turns it off.
    // The evening brief is the mirror image: OPT-IN, so an explicit true is
    // required. Nobody gets a new 8pm message because we shipped a feature.
    const prefs = await db.getNotificationPreferences(member.id).catch(() => null);
    const briefDisabled = options.ignoreOptOut
      ? false
      : variant === 'evening'
        ? !(prefs && prefs.evening_brief === true)
        : !!(prefs && prefs.whatsapp_daily_reminder === false);
    const whatsappLinked = !!(member.whatsapp_linked && member.whatsapp_phone);

    // App installed? = has ≥1 active push device token. App users get the
    // richer push brief; everyone else falls back to the WhatsApp digest.
    let deviceTokens = [];
    try { deviceTokens = (await db.getActiveDeviceTokens(member.id)) || []; } catch { deviceTokens = []; }
    const hasDevices = deviceTokens.length > 0;

    // School activities for the anchor day. Only include if that day is during
    // term time (not holidays, half term, INSET, or bank holiday). Derived from
    // `today` rather than the clock - an evening brief listing this afternoon's
    // swimming would be worse than listing nothing.
    const schoolActivities = [];
    try {
      const dayOfWeek = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // JS day (0=Sun) → ours (0=Mon)
      if (dayOfWeek <= 4) { // Only Mon-Fri
        const todayStr = today;
        const allMembers = householdMembers;
        const dependents = allMembers.filter(m => m.member_type === 'dependent');
        const householdSchools = await db.getHouseholdSchools(householdId).catch(() => []);

        for (const child of dependents) {
          // Resolve which school's term calendar applies to this child (their
          // own school_id, or the household's single school). Only gate on
          // term-in-session when a school resolves; with no school the activity's
          // own term window is the only gate.
          const { isSchoolInSession, activityActiveOn, resolveTermSchoolForChild } = require('../utils/school-terms');
          const termSchoolId = resolveTermSchoolForChild(child, householdSchools);
          // School holiday/inset/half-term suppresses TERM-WINDOWED
          // activities only. An activity with no window is ongoing (gym,
          // private tennis) and runs right through the holidays - a
          // blanket per-child skip here is how those vanished from the
          // brief every holiday.
          const schoolInSession = !termSchoolId || (await isSchoolInSession(termSchoolId, todayStr));

          const activities = await db.getChildActivities(child.id);
          // Honour the activity's term window (today inside [start_date,
          // end_date], NULL dates = ongoing) and per-date skips ("no
          // swimming today" must keep it out of the morning brief too).
          const todayActivities = activities.filter(a =>
            a.day_of_week === dayOfWeek && a.term_only !== false && activityActiveOn(a, todayStr)
            && (schoolInSession || (!a.start_date && !a.end_date))
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

    // Real content = schedule/dinner/reminders. Weather and tips are garnish
    // and never justify a business-initiated message on their own.
    // Dinner counts as content in the morning, where it's printed. The evening
    // brief doesn't carry it, so it mustn't be the reason one gets sent.
    const hasContent = (todayEvents || []).length > 0
      || schoolActivities.length > 0
      || (variant !== 'evening' && !!dinner?.meal_name)
      || (taskReminders || []).length > 0
      || (billReminders || []).length > 0;
    const waState = whatsappLinked ? whatsappBriefState(member) : null;

    // One-time dormant sign-off: tell the long-silent user the morning
    // messages are stopping (and how to restart) at exactly the moment an
    // annoyed user would otherwise block. Stamp FIRST - if the column
    // isn't migrated yet the update fails and we skip, which can repeat
    // nothing; sending first could repeat the sign-off daily.
    // Morning only: the sign-off is about the 07:00 ritual stopping, and the
    // evening brief is something they explicitly asked for - it doesn't get
    // retired for silence, and must never fire this message.
    if (variant === 'morning' && waState === 'dormant' && whatsappLinked && !member.whatsapp_brief_signoff_sent_at && !briefDisabled) {
      try {
        await db.updateUser(member.id, { whatsapp_brief_signoff_sent_at: new Date().toISOString() });
        const { sendBroadcastToMember } = require('../services/whatsapp-templates');
        await sendBroadcastToMember(member,
          `I'll stop the morning messages here, ${(member.name || '').split(/\s+/)[0] || 'there'} - I don't want to clutter your chats. 👋\n\nReply any time and I'll pick straight back up. You can also switch the daily brief on or off in Settings → Notifications.`);
        console.log(`[reminders] Sent dormant sign-off to ${member.name}`);
      } catch (err) {
        console.warn('[reminders] dormant sign-off skipped:', err.message);
      }
    }

    // The evening brief is opt-in, so engagement-based channel retirement
    // doesn't apply: dormancy must neither silence it nor reroute it - the
    // user explicitly asked for it. Coerce 'dormant' to 'active' rather than
    // nulling the whole state: nulling skipped the ENTIRE WhatsApp branch of
    // the chooser, so every app-owning member fell to push - including
    // WhatsApp-ACTIVE users whose morning brief (and the in-thread "yes"
    // that enabled evenings) lives in the WhatsApp thread. Real report
    // 2026-08-05: morning arrived on WhatsApp, evening as a push.
    // forceChannel is for the admin self-preview ONLY. Push wins whenever the
    // app is installed, which makes the WhatsApp copy - and a newly approved
    // template - impossible to verify from a phone that has the app on it.
    // The cron never passes it.
    const channel = options.forceChannel
      || chooseDailyBriefChannel({ hasDevices, whatsappLinked, briefDisabled, waState: effectiveBriefWaState(variant, waState), hasContent });
    if (!channel) {
      console.log(`[reminders] Skipping ${member.name} - no channel (devices=${hasDevices}, whatsapp=${whatsappLinked}, disabled=${briefDisabled}, state=${waState}, content=${hasContent})`);
      continue;
    }

    const buildOpts = {
      todayEvents,
      shoppingCount,
      schoolActivities,
      clashLines,
      tz,
      linkedAt: member.whatsapp_linked_at || null,
      weatherLine,
      dinner,
      taskReminders,
      billReminders,
      variant,
      anchorDate: today,
    };
    // ── Push channel (app installed): warm, LLM-generated copy that varies
    // each day, free of WhatsApp's rigid template rules. Reuses the exact
    // same digest data (parts.body) as the source, rewritten conversationally.
    if (channel === 'push') {
      const parts = buildDailyReminderParts(member, buildOpts);
      const { title, body: generatedBody } = await generateMorningBriefPush(
        {
          name: parts.name,
          weekday: parts.weekday,
          summary: parts.body,
          variant,
          counts: {
            eventCount: todayEvents.length,
            taskCount: taskReminders.length,
            billCount: billReminders.length,
          },
        },
        { householdId, userId: member.id },
      );
      // A double-booking must survive the LLM rewrite: the summary feeds the
      // model, but nothing guarantees the warning makes the 280-char cut -
      // append it deterministically unless the model already mentioned it.
      const body = (clashLines.length > 0 && !generatedBody.includes('⚠️'))
        ? `${generatedBody}\n${clashLines.join('\n')}`
        : generatedBody;
      let pushSent = 0;
      // The durable in-app copy: the brief is the longest push we send and
      // the one most often truncated on the lock screen.
      await push.recordForUsers([member.id], {
        title,
        body,
        data: { type: variant === 'evening' ? 'evening_brief' : 'morning_brief' },
        householdId,
      });
      try {
        const result = await push.sendPushNotification(
          deviceTokens.map((t) => t.token),
          { title, body, data: { type: variant === 'evening' ? 'evening_brief' : 'morning_brief' } },
        );
        pushSent = result.sent;
        console.log(`[reminders] ${variant === 'evening' ? 'Evening' : 'Morning'} brief push → ${member.name}: sent=${result.sent} failed=${result.failed}`);
      } catch (err) {
        console.error(`Failed to send morning brief push to ${member.name}:`, err.message);
      }
      // Push is the chosen channel, but it can go silently dead (stale tokens,
      // an APNs env/config problem, a pruned token). If NOTHING was delivered,
      // fall back to the WhatsApp digest so the brief still lands - a dead-push
      // spell must never quietly kill it. Delivered to ≥1 device, or no WhatsApp
      // to fall back to → done; otherwise drop through to the WhatsApp send.
      if (pushSent > 0 || !whatsappLinked) continue;
      console.warn(`[reminders] Morning brief push delivered 0 for ${member.name}; falling back to WhatsApp`);
    }

    // ── WhatsApp channel (no app installed, or push fell back): the legacy digest ──
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
      // The morning template's STATIC body says "Good morning" - Twilio
      // variables can't carry structure, which is exactly why the greeting
      // lives there. So the evening brief needs its own approved template and
      // must never borrow the morning one; without it, WhatsApp is skipped
      // and app users still get the push.
      const templateSid = variant === 'evening'
        ? process.env.TWILIO_TEMPLATE_EVENING_BRIEF
        : process.env.TWILIO_TEMPLATE_DAILY_REMINDER;
      if (variant === 'evening' && !templateSid) {
        console.log(`[reminders] Skipping evening WhatsApp brief for ${member.name} - TWILIO_TEMPLATE_EVENING_BRIEF not set`);
        continue;
      }
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
          messageType: variant === 'evening' ? 'evening_brief' : 'daily_reminder',
          body: message,
        });
        await offerEveningBriefOnce(member, variant);
      } catch (err) {
        console.error(`Failed to send reminder to ${member.name} via WhatsApp:`, err.message);
        await db.logWhatsAppMessage({
          householdId,
          userId: member.id,
          direction: 'outbound',
          messageType: variant === 'evening' ? 'evening_brief' : 'daily_reminder',
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
  effectiveBriefWaState,
  whatsappBriefState,
  sendDailyReminders,
  offerEveningBriefOnce,
};
