/**
 * Morning-brief push copy generator.
 *
 * The daily morning brief is delivered as an iOS push notification when the
 * member has the app installed (primary), falling back to the WhatsApp
 * digest otherwise. Unlike the WhatsApp path - which is constrained by
 * Meta's rigid utility-template rules - a push body is free-form, so we
 * generate warm, natural copy that varies each day (the "Poppy" style):
 *
 *   "Morning! You've got a fresh start today, and I don't see any meetings
 *    or urgent items on your plate for now."
 *   "Good morning Grant! You've got a clear calendar today, but I've got
 *    your back on everything else that comes up."
 *
 * Generation is best-effort: if the LLM is unavailable we fall back to a
 * deterministic, lightly-rotating message built from the day's counts, so a
 * member never gets a blank or missing brief.
 */

const { callWithFailover } = require('./ai-client');

const SYSTEM = `You write ONE short morning-briefing push notification for a member of Housemait, a warm family-organiser app.

Voice: like a calm, capable friend - warm and natural, never corporate or robotic. British spelling is fine, but use plain, widely-understood words and NO regional slang (say "umbrella", not "brolly"; "breakfast", not "brekkie") - families in many countries use Housemait. No emoji. No hashtags. No surrounding quotation marks. Punctuate with commas and full stops only - never use em dashes or en dashes (— –).

Length: 1-3 short sentences. Keep it under ~240 characters - it's a phone lock-screen notification.

What to say: greet them (vary the opener naturally - "Morning!", "Good morning {name}!", "Morning {name} -"). Then surface what genuinely matters today from the data: pull out the 1-2 most important things (an early event, a task or bill due, the school run). If the day is quiet or empty, reassure them warmly that it's a clear, calm day rather than listing nothing. You may gently offer that you're around if they need anything (their calendar, lists or tasks) - but NEVER claim to read their email or do anything Housemait can't.

Style: do NOT mechanically list every item, and do NOT reuse the same phrasing every day - vary the opening and the structure so it reads freshly written each morning. Output ONLY the notification text, nothing else.`;

/**
 * Collapse whitespace and trim to a notification-friendly length, preferring
 * a sentence boundary, then a word boundary.
 */
function clampBody(text, max = 280) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > max * 0.5) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Deterministic fallback used when the LLM can't be reached. Rotates the
 * empty-day phrasing by day-of-month so a quiet week doesn't read identically
 * every morning.
 */
function fallbackBody(name, counts = {}) {
  const { eventCount = 0, taskCount = 0, billCount = 0 } = counts;
  const greet = name ? `Morning, ${name}!` : 'Morning!';
  const bits = [];
  if (eventCount) bits.push(`${eventCount} thing${eventCount > 1 ? 's' : ''} on your calendar`);
  if (taskCount) bits.push(`${taskCount} task${taskCount > 1 ? 's' : ''} to keep an eye on`);
  if (billCount) bits.push(`${billCount} bill${billCount > 1 ? 's' : ''} due soon`);

  if (bits.length === 0) {
    const quiet = [
      `${greet} Your day looks clear - enjoy the calm, and I've got your back if anything comes up.`,
      `${greet} Nothing scheduled today, so it's a nice quiet one. Give me a shout if you need anything.`,
      `${greet} A fresh, open day ahead - I'll let you know the moment anything lands.`,
    ];
    const idx = new Date().getDate() % quiet.length;
    return quiet[idx];
  }

  const list = bits.length === 1
    ? bits[0]
    : `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
  return `${greet} You've got ${list} today. Tap to see the details.`;
}

/**
 * Build the morning-brief push payload for a member.
 *
 * @param {object} input
 * @param {string} input.name    - member's display name (first name is used)
 * @param {string} [input.weekday] - e.g. "Wednesday"
 * @param {string} [input.summary] - the factual digest body (same text the
 *   WhatsApp brief renders); empty/absent means a quiet day
 * @param {object} [input.counts] - { eventCount, taskCount, billCount } for the fallback
 * @param {object} [ctx] - { householdId, userId } for AI cost attribution
 * @returns {Promise<{ title: string, body: string }>}
 */
async function generateMorningBriefPush({ name, weekday, summary, counts } = {}, { householdId, userId } = {}) {
  const firstName = (name || '').split(' ')[0] || '';
  const title = 'Morning briefing';
  let body = null;

  try {
    const dataBlock = summary && summary.trim()
      ? `Today's briefing data for ${firstName || 'them'}${weekday ? ` (${weekday})` : ''}:\n${summary.trim()}`
      : `${firstName || 'They'} have nothing scheduled today${weekday ? ` (${weekday})` : ''} - an empty, quiet day.`;

    const { text } = await callWithFailover({
      system: SYSTEM,
      messages: [{ role: 'user', content: `${dataBlock}\n\nWrite their morning briefing notification.` }],
      maxTokens: 160,
      useThinking: false,
      feature: 'morning_brief',
      householdId,
      userId,
    });

    const cleaned = (text || '').trim().replace(/^["']|["']$/g, '');
    if (cleaned) body = clampBody(cleaned);
  } catch (err) {
    console.warn('[morning-brief] LLM generation failed, using fallback:', err.message);
  }

  if (!body) body = clampBody(fallbackBody(firstName, counts));
  return { title, body };
}

module.exports = { generateMorningBriefPush, clampBody, fallbackBody };
