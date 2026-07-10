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

// The Family page's "Allergies & dietary requirements" chips are stored on
// households.allergies as an array of keys (see web/src/pages/FamilySetup.jsx).
// That's a SEPARATE, explicit source from the classifier-learned
// household_preferences, so every AI surface must merge BOTH — otherwise a
// ticked allergen is honoured on one channel (the web chat reads the chips) but
// silently ignored on another (the WhatsApp bot only read the learned rows).
// Map each chip key to a human label and its constraint type.
const HOUSEHOLD_ALLERGEN_CHIPS = {
  celery: { label: 'Celery', key: 'allergy' },
  gluten: { label: 'Gluten', key: 'allergy' },
  crustaceans: { label: 'Crustaceans', key: 'allergy' },
  eggs: { label: 'Eggs', key: 'allergy' },
  fish: { label: 'Fish', key: 'allergy' },
  lupin: { label: 'Lupin', key: 'allergy' },
  milk: { label: 'Milk / dairy', key: 'allergy' },
  molluscs: { label: 'Molluscs', key: 'allergy' },
  mustard: { label: 'Mustard', key: 'allergy' },
  nuts: { label: 'Tree nuts', key: 'allergy' },
  peanuts: { label: 'Peanuts', key: 'allergy' },
  sesame: { label: 'Sesame', key: 'allergy' },
  soya: { label: 'Soya', key: 'allergy' },
  sulphites: { label: 'Sulphites', key: 'allergy' },
  vegetarian: { label: 'Vegetarian', key: 'dietary' },
  vegan: { label: 'Vegan', key: 'dietary' },
  halal: { label: 'Halal', key: 'dietary' },
  kosher: { label: 'Kosher', key: 'dietary' },
};

// Normalise households.allergies (a JSON string or array of chip keys) into
// preference-shaped rows { key: 'allergy'|'dietary', value: label }. Unknown
// keys are dropped. Household-wide, so member_name is null ("Everyone").
function householdAllergiesToPreferences(allergies) {
  let list = allergies;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const chip = HOUSEHOLD_ALLERGEN_CHIPS[String(raw).trim().toLowerCase()];
    if (chip) out.push({ key: chip.key, value: chip.label, member_id: null, member_name: null, source: 'household' });
  }
  return out;
}

// Merge the Family-page allergen/dietary chips into the learned preferences,
// de-duping so a chip that duplicates a learned row (same key + value, case-
// insensitive) isn't listed twice. Use this wherever an AI surface builds an
// allergy/dietary context so both sources are always honoured.
function mergeHouseholdAllergies(preferences, allergies) {
  const base = Array.isArray(preferences) ? preferences.slice() : [];
  const seen = new Set(base.map((p) => `${p.key}::${String(p.value || '').trim().toLowerCase()}`));
  for (const row of householdAllergiesToPreferences(allergies)) {
    const k = `${row.key}::${row.value.trim().toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    base.push(row);
  }
  return base;
}

module.exports = {
  KEY_PRIORITY,
  formatPreferenceLines,
  formatRecipeConstraints,
  householdAllergiesToPreferences,
  mergeHouseholdAllergies,
};
