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
  /\b(?:remind|nudge|ping|notify|alert)\s+(?:me|us)\s+(\d+|\w+)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:before|earlier|prior)\b/gi,
  // "with a 30 minute reminder" / "with an hour alert"
  /\bwith\s+(?:a|an|one)\s+(\d+|\w+)?\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:reminder|alert|notice|notification|warning)\b/gi,
  // "with a 30 min" form when only the number + unit are given
  /\bwith\s+(?:a|an)\s+(\d+)\s*(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\b/gi,
  // "10 minute reminder" / "1 hour alert" (no "with a")
  /\b(\d+|\w+)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:reminder|alert|notice|notification|warning)\b/gi,
  // "10 minutes before" / "a day before" - generic fallback
  /\b(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|sixty)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:before|earlier|prior)\b/gi,
];

function parseRemindersFromMessage(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const out = [];
  const seen = new Set();
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const numRaw = m[1];
      const unitRaw = m[2];
      const time = parseNumber(numRaw);
      const unit = unitFromWord(unitRaw);
      if (!time || !unit) continue;
      const key = `${time}:${unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ time, unit });
    }
  }
  return out;
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
    /\b(min|mins|minute|minutes|hr|hrs|hour|hours|day|days)\s+(?:before|earlier|prior)\b/i.test(t)
  );
}

module.exports = {
  parseRemindersFromMessage,
  messageMentionsReminder,
};
