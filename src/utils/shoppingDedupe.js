/**
 * Shopping-list dedupe helpers.
 *
 * Two utilities used by the add-item paths (POST /shopping, bot batch
 * adds, classify, chat, meals→shopping) to catch the common "I typed
 * the same thing slightly differently" pattern:
 *
 *   • "Gluten Free Nuggets"   → already on list
 *   • "Gluten-Free Nuggets"   → punctuation differs only → DUPLICATE
 *   • "gluten-free nuggets"   → case + punctuation differ → DUPLICATE
 *   • "Gluten-Free Nugets"    → typo → NOT caught (different spelling)
 *
 * The normaliser purely strips common punctuation, lowercases, and
 * collapses whitespace. It never touches the stored `item` string -
 * that's preserved as the user typed it for display. Normalisation
 * is used only for the dedupe key.
 *
 * The override-hint detector lets users force a duplicate add by
 * saying "another milk", "extra eggs", "add it anyway" etc. via the
 * bot. Without an override, duplicates are silently skipped and
 * surfaced back in the response so the caller can tell the user.
 */

const PUNCT_RE = /[-_'./,!?;:()]/g;
const WS_RE = /\s+/g;

function normalizeItemName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(PUNCT_RE, ' ')   // hyphens, apostrophes, periods, etc → space
    .replace(WS_RE, ' ')      // collapse runs of whitespace
    .trim();
}

// Word boundaries match override phrases that indicate the user
// explicitly wants the duplicate. Single-word triggers are enough -
// people don't usually say "I want an additional fourth carton of"
// without one of these words appearing.
const OVERRIDE_RE = /\b(another|more|additional|extra|second|third|fourth|anyway|again|also|too)\b/i;

function detectOverrideHint(text) {
  if (!text) return false;
  return OVERRIDE_RE.test(String(text));
}

module.exports = { normalizeItemName, detectOverrideHint };
