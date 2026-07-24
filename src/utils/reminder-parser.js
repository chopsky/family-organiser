/**
 * Deterministic fallback for parsing reminder-lead phrases out of a
 * user's message. Exists because the LLM classifier sometimes claims
 * "I'll remind you 10 minutes before" in response_message while
 * leaving the structured `reminders` array null - the user then has
 * an event with no actual reminder. Prompt rules help but don't fully
 * eliminate the drift; this regex pass is the structural backstop.
 *
 * Returns an array of `{time, unit}` shapes matching the database
 * schema (the same shape callers pass to db.saveEventReminders).
 * Returns an empty array if no reminder phrase is found.
 *
 * Recognised patterns (case-insensitive):
 *   "remind me N <unit> before"           - "remind me 10 minutes before"
 *   "remind me N <unit> earlier"
 *   "N <unit> before"                     - "10 mins before"
 *   "N <unit> earlier"
 *   "with a/an N <unit> reminder"         - "with a 30 min reminder"
 *   "with a/an N <unit> alert"
 *   "with a/an N <unit> notice"
 *   "N <unit> reminder"                   - "10 minute reminder"
 *   "N <unit> alert"                      - "1 hour alert"
 *   "nudge/ping/notify/alert me N <unit> before"
 *   "remind me a day/an hour before"      - implicit "1"
 *   "a day before" / "an hour before"     - implicit "1"
 *
 * Multiple reminders in one message are all collected, e.g.
 *   "remind me 1 day before and 30 minutes before"
 *   - [{time:1, unit:"days"}, {time:30, unit:"minutes"}]
 */

const UNIT_WORDS = {
  min: 'minutes', mins: 'minutes', minute: 'minutes', minutes: 'minutes',
  hr: 'hours', hrs: 'hours', hour: 'hours', hours: 'hours',
  day: 'days', days: 'days',
};

// Numeric words for "an hour" / "a day" / "a minute" style phrasing.
const ARTICLE_AS_ONE = /^(an?|one)$/i;

// Word-to-digit for spelled-out small numbers ("five minutes before").
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, sixty: 60,
};

function parseNumber(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim().toLowerCase();
  if (ARTICLE_AS_ONE.test(trimmed)) return 1;
  if (NUMBER_WORDS[trimmed] !== undefined) return NUMBER_WORDS[trimmed];
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unitFromWord(word) {
  if (!word) return null;
  return UNIT_WORDS[String(word).trim().toLowerCase()] || null;
}

// Source of the patterns. Order matters - more specific phrasings come
// first so the broader catch-alls don't shadow them. Each entry's regex
// uses two capture groups: (number, unit). The number can be a digit
// ("10"), an article ("a"/"an"), or a word ("ten").
const PATTERNS = [
  // "remind me 10 minutes before" / "nudge me 30 mins prior"
  /\b(?:remind|nudge|ping|notify|alert)\s+(?:me|us)\s+(\d+|\w+)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:before|earlier|prior|ahead)\b/gi,
  // "with a 30 minute reminder" / "with an hour alert"
  /\bwith\s+(?:a|an|one)\s+(\d+|\w+)?\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:reminder|alert|notice|notification|warning)\b/gi,
  // "with a 30 min" form when only the number + unit are given
  /\bwith\s+(?:a|an)\s+(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\b/gi,
  // "10 minute reminder" / "1 hour alert" (no "with a")
  /\b(\d+|\w+)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:reminder|alert|notice|notification|warning)\b/gi,
  // "10 minutes before" / "a day before" - generic fallback
  /\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:before|earlier|prior|ahead)\b/gi,
];

// Number-less phrasings people actually type, mapped straight to offsets.
// The bot's own follow-up question suggests "the day before" as an example -
// a user replying with exactly that phrase (or the bare "day before") used
// to parse to NOTHING and loop the question forever. Matched text is
// consumed before the numeric PATTERNS run so "half an hour before" can't
// ALSO match "an hour before" and save a second, wrong reminder.
const SPECIAL_PHRASES = [
  { re: /\bhalf\s+an?\s+hour\s+(?:before|earlier|prior|ahead)\b/gi, offsets: [{ time: 30, unit: 'minutes' }] },
  { re: /\b(?:the\s+)?(?:day|night|evening|morning)\s+before\b/gi, offsets: [{ time: 1, unit: 'days' }] },
  { re: /\b(?:the\s+)?hour\s+before\b/gi, offsets: [{ time: 1, unit: 'hours' }] },
];

function parseRemindersFromMessage(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out = [];
  const seen = new Set();
  const push = ({ time, unit }) => {
    const key = `${time}:${unit}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ time, unit });
  };
  // Number-less phrases first, consuming what they match.
  let remaining = text;
  for (const { re, offsets } of SPECIAL_PHRASES) {
    if (re.test(remaining)) {
      re.lastIndex = 0;
      offsets.forEach(push);
      remaining = remaining.replace(re, ' ');
    }
  }
  for (const pattern of PATTERNS) {
    for (const m of remaining.matchAll(pattern)) {
      const time = parseNumber(m[1]);
      const unit = unitFromWord(m[2]);
      if (!time || !unit) continue;
      push({ time, unit });
    }
  }
  return out;
}

// Whole-message bare duration - ONLY safe when we just asked "how long
// before?" and the reply is nothing but a lead time: "2 hours", "30 mins",
// "1 hr", "a day", "half an hour", "in 20 minutes". Deliberately anchored to
// the full string so it can never misread durations inside longer messages
// ("book the court for 2 hours"); callers use it exclusively on pending
// reminder replies.
const BARE_DURATION_RE = /^\s*(?:in\s+)?(?:(half)\s+an?\s+|(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s*)(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s*(?:before|earlier|prior|ahead)?\s*[.!?\s]*$/i;

function parseBareDuration(text) {
  if (typeof text !== 'string') return [];
  const m = text.match(BARE_DURATION_RE);
  if (!m) return [];
  if (m[1]) {
    // "half an hour" (the only half-form worth supporting)
    return /^h/i.test(m[3]) ? [{ time: 30, unit: 'minutes' }] : [];
  }
  const time = parseNumber(m[2]);
  const unit = unitFromWord(m[3]);
  return time && unit ? [{ time, unit }] : [];
}

// Human phrasing for a saved offset list, for confirmation copy:
//   [{1,days}] → "the day before" ; [{2,hours}] → "2 hours before" ;
//   [{1,days},{30,minutes}] → "the day before and 30 minutes before".
function describeOffsets(offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0) return 'before';
  const one = ({ time, unit }) => {
    if (unit === 'days' && time === 1) return 'the day before';
    if (unit === 'hours' && time === 1) return 'an hour before';
    const label = time === 1 ? unit.replace(/s$/, '') : unit;
    return `${time} ${label} before`;
  };
  return offsets.map(one).join(' and ');
}

// Cheap sniff: does the user's message even mention reminder-like
// intent at all? Used as a guard so we don't run the heavier regex on
// every message. (Both checks are O(n) but the includes is faster and
// the regex pass is short-circuited when nothing matches.)
function messageMentionsReminder(text) {
  if (typeof text !== 'string') return false;
  const t = text.toLowerCase();
  return (
    t.includes('remind') ||
    t.includes('nudge') ||
    t.includes('alert') ||
    t.includes('notify') ||
    t.includes('notification') ||
    /\b(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:before|earlier|prior|ahead)\b/i.test(t)
  );
}

// ── Task notification enum snapping ───────────────────────────────────────
// The tasks table has a hard-enum `notification` column accepting only:
//   at_time, 5_min, 15_min, 30_min, 1_hour, 2_hours, 1_day, 2_days
// The reminder parser above produces arbitrary {time, unit} offsets.
// snapToTaskNotification picks the legal enum value closest to the
// requested offset (measured in minutes). On ties the longer lead time
// wins so we don't under-nudge the user.
//
// Returns { value, snapped, requestedLabel, chosenLabel }:
//   value           - the enum string ready to save (or null if input invalid)
//   snapped         - true if the requested offset wasn't an exact enum match
//   requestedLabel  - "20 minutes" (what the user asked for)
//   chosenLabel     - "15 minutes" (what we'll actually save)
const NOTIFICATION_ENUM_MINUTES = [
  { value: 'at_time', minutes: 0,    label: 'at the time' },
  { value: '5_min',   minutes: 5,    label: '5 minutes' },
  { value: '15_min',  minutes: 15,   label: '15 minutes' },
  { value: '30_min',  minutes: 30,   label: '30 minutes' },
  { value: '1_hour',  minutes: 60,   label: '1 hour' },
  { value: '2_hours', minutes: 120,  label: '2 hours' },
  { value: '1_day',   minutes: 1440, label: '1 day' },
  { value: '2_days',  minutes: 2880, label: '2 days' },
];

function offsetToMinutes(time, unit) {
  const t = parseInt(time, 10);
  if (!Number.isFinite(t) || t < 0) return null;
  switch (unit) {
    case 'minutes': return t;
    case 'hours':   return t * 60;
    case 'days':    return t * 24 * 60;
    case 'weeks':   return t * 7 * 24 * 60;
    default:        return null;
  }
}

function snapToTaskNotification(reminder) {
  if (!reminder || typeof reminder !== 'object') return null;
  const minutes = offsetToMinutes(reminder.time, reminder.unit);
  if (minutes === null) return null;

  // Exact-match short-circuit: if the user's request lands on an enum
  // value, no snap occurred.
  const exact = NOTIFICATION_ENUM_MINUTES.find(e => e.minutes === minutes);
  const requestedLabel = `${reminder.time} ${reminder.unit}`;
  if (exact) {
    return {
      value: exact.value,
      snapped: false,
      requestedLabel,
      chosenLabel: exact.label,
    };
  }

  // Find the closest enum by absolute distance in minutes. Tie-break by
  // preferring the LARGER lead time - if the user asks for 45 min
  // (equidistant from 30 and 60), we'd rather nudge them earlier than
  // later.
  let best = NOTIFICATION_ENUM_MINUTES[0];
  let bestDist = Math.abs(minutes - best.minutes);
  for (const candidate of NOTIFICATION_ENUM_MINUTES) {
    const dist = Math.abs(minutes - candidate.minutes);
    if (dist < bestDist || (dist === bestDist && candidate.minutes > best.minutes)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return {
    value: best.value,
    snapped: true,
    requestedLabel,
    chosenLabel: best.label,
  };
}

module.exports = {
  parseRemindersFromMessage,
  parseBareDuration,
  messageMentionsReminder,
  snapToTaskNotification,
  describeOffsets,
};
