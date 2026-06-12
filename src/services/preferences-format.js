/**
 * Shared formatters for learned family preferences (household_preferences).
 *
 * Preferences are captured automatically by the classifier ("Lynn is allergic
 * to nuts", "Tuesdays are soccer") and stored per household/member. Three AI
 * surfaces consume them and MUST agree on how a constraint reads, or the bot
 * honours an allergy on WhatsApp but forgets it in a generated recipe:
 *   - the WhatsApp classifier system prompt (src/services/ai.js),
 *   - the web/app chat assistant (src/routes/chat.js),
 *   - the recipe generator (src/bot/handlers.js).
 * Centralising the formatting here keeps them in lockstep.
 *
 * Each preference row is { key, value, member_id?, member_name? }. `key` is one
 * of: allergy | dietary | dislike | like | schedule | preference. Allergy and
 * dietary are HARD constraints; dislike is soft; like is a positive bias;
 * schedule is a recurring time anchor.
 */

// Lower number = render first (hardest constraint leads).
const KEY_PRIORITY = { allergy: 0, dietary: 1, dislike: 2, like: 3, schedule: 4, preference: 5 };

function sortByPriority(preferences) {
  return (preferences || []).slice().sort((a, b) => {
    const ap = KEY_PRIORITY[a.key] ?? 99;
    const bp = KEY_PRIORITY[b.key] ?? 99;
    if (ap !== bp) return ap - bp;
    return (a.value || '').localeCompare(b.value || '');
  });
}

/**
 * One line per preference, grouped hardest-first, attributed to the member it
 * belongs to (or "Everyone" for household-wide rows). This is the block the
 * classifier and the chat assistant inject under their FAMILY PREFERENCES
 * heading. Rows should already carry `member_name` (callers resolve it from
 * member_id); a bare member_id with no name falls back to "(member)".
 *
 *   - [ALLERGY] Lynn: nuts
 *   - [SCHEDULE] Everyone: Tuesdays are soccer night
 */
function formatPreferenceLines(preferences, emptyText = '(none saved yet)') {
  const sorted = sortByPriority(preferences);
  if (sorted.length === 0) return emptyText;
  return sorted.map((p) => {
    const who = p.member_name || (p.member_id ? '(member)' : 'Everyone');
    return `- [${String(p.key).toUpperCase()}] ${who}: ${p.value}`;
  }).join('\n');
}

// De-dupe values case-insensitively while preserving the first-seen casing,
// so "Nuts" and "nuts" don't both appear in a constraint line.
function uniqueValues(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const v = (r.value || '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Recipe-specific constraint block. Member attribution is dropped on purpose:
 * a recipe is shared, so if ANYONE in the household is allergic to nuts the
 * recipe must avoid them regardless of whose allergy it is. Returns '' when
 * there's nothing relevant, so callers can conditionally append it.
 *
 * allergy/dietary => hard constraints, dislike => soft avoid, like => bias.
 * schedule/preference are irrelevant to a recipe and ignored.
 */
function formatRecipeConstraints(preferences) {
  const byKey = (key) => uniqueValues((preferences || []).filter((p) => p.key === key));
  const allergies = byKey('allergy');
  const dietary = byKey('dietary');
  const dislikes = byKey('dislike');
  const likes = byKey('like');

  const lines = [];
  if (allergies.length) lines.push(`- ALLERGIES (NEVER include these or any ingredient containing them): ${allergies.join(', ')}`);
  if (dietary.length) lines.push(`- DIETARY RULES (must respect): ${dietary.join(', ')}`);
  if (dislikes.length) lines.push(`- DISLIKES (avoid unless the request explicitly asks for them): ${dislikes.join(', ')}`);
  if (likes.length) lines.push(`- LIKES (lean towards these where they fit): ${likes.join(', ')}`);
  if (lines.length === 0) return '';
  return `The family has these standing food preferences - honour them, and treat ALLERGIES and DIETARY RULES as hard safety constraints that override the request if they conflict:\n${lines.join('\n')}`;
}

module.exports = {
  KEY_PRIORITY,
  formatPreferenceLines,
  formatRecipeConstraints,
};
