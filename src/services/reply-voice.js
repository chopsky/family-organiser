/**
 * Reply voice layer — BOT_VOICE=1 (ships dark; founder flips on Railway).
 *
 * The deterministic handlers are the source of TRUTH; this layer is the
 * source of TONE. A handler computes its facts and its template reply as
 * always, then (flag on) a cheap Haiku pass rephrases the reply as natural
 * conversation — "Done! You're now at Nici Bournemouth Sun 23 – Wed 26 Aug"
 * instead of '✏️ Updated "Staying at Nici Bournemouth" - now until Wed 26
 * Aug.' Founder brief (2026-07-22): "It should all sound like natural
 * conversation… like I'm chatting to an actual person."
 *
 * Safety posture mirrors the agent loop:
 *   - The composer receives the facts and MUST include all of them; it may
 *     add nothing (no invented offers, no new questions).
 *   - A cheap anchor check (reply must still name the item) catches
 *     drift; any failure/timeout/anchor miss returns null and the caller
 *     sends the template unchanged. The voice can only improve tone,
 *     never alter truth or block a reply.
 *   - Same pattern as composeWeatherAnswer; same call-time flag +
 *     kill-switch discipline as BOT_PIPELINE / BOT_ROUTER / BOT_AGENT.
 *
 * Caching discipline: static system block (cacheable), all dynamic values
 * in the user message.
 */

const { callClaude, CLAUDE_HAIKU_MODEL } = require('./ai-client');

const VOICE_TIMEOUT_MS = 2500;

function voiceEnabled() {
  return process.env.BOT_VOICE === '1';
}

const SYSTEM_STATIC = [
  'You rewrite one WhatsApp reply from Housemait, a warm family assistant used by busy UK parents.',
  'You receive FACTS (JSON) and the current TEMPLATE reply. Rewrite the reply as one or two short,',
  'natural, conversational sentences - like a capable friend texting back.',
  '',
  'Hard rules:',
  '- Include EVERY fact. Never drop the item name, dates, times, or the undo hint when present.',
  '- Add NOTHING: no new information, no offers, no questions the template does not ask.',
  '- Keep any bullet list in the template as a bullet list; only rewrite the words around it.',
  "- British English, first person (\"I've moved…\"), at most one emoji, no exclamation overload.",
  '- Dates read like "Sun 23 Aug", times like "4:30pm". Never ISO formats.',
  '- Output ONLY the rewritten reply text.',
].join('\n');

/**
 * Rephrase `template` using `facts`. Returns the voiced reply, or null on
 * any trouble (caller sends the template).
 *
 * anchor: a string that MUST appear (case-insensitive) in the output -
 * normally the item title. Catches the model drifting off the facts.
 */
async function composeVoicedReply({ facts, template, anchor }) {
  if (!voiceEnabled()) return null;
  try {
    const result = await callClaude({
      model: CLAUDE_HAIKU_MODEL,
      maxTokens: 300,
      timeoutMs: VOICE_TIMEOUT_MS,
      system: [{ text: SYSTEM_STATIC, cache: true }],
      messages: [{
        role: 'user',
        content: `FACTS: ${JSON.stringify(facts)}\nTEMPLATE: ${template}`,
      }],
    });
    const text = (typeof result === 'string' ? result : result?.text || '')
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!text || text.length > 600) return null;
    if (anchor && !text.toLowerCase().includes(String(anchor).toLowerCase())) {
      console.warn('[reply-voice] anchor missing from voiced reply - using template');
      return null;
    }
    return text;
  } catch (err) {
    console.warn('[reply-voice] falling back to template:', err.message);
    return null;
  }
}

module.exports = { voiceEnabled, composeVoicedReply, VOICE_TIMEOUT_MS };
