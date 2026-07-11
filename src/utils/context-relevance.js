/**
 * Keyword gates for CONDITIONAL classify context (Phase 3) — same pattern as
 * utils/location-relevance.js. The mega-prompt stays lean by default; a
 * section (this week's meal plan / current shopping list / kids' star
 * balances) is fetched and injected ONLY when the message plausibly needs it.
 *
 * Gates are deliberately generous: a false positive costs a few hundred
 * prompt tokens; a false negative means the bot answers "I don't know what's
 * for dinner" while the meal plan sits in the DB.
 */

function messageMentionsMeals(message) {
  const text = String(message || '').toLowerCase();
  return /\b(dinner|lunch|breakfast|supper|tea tonight|meal|meals|menu|cook|cooking|eat|eating|food|recipe|what'?s for)\b/.test(text);
}

function messageMentionsShopping(message) {
  const text = String(message || '').toLowerCase();
  return /\b(shopping|groceries|grocery|shop|buy|bought|out of|run(ning)? out|need more|supermarket|tesco|sainsbury|aldi|lidl|asda|ocado)\b/.test(text);
}

function messageMentionsStars(message) {
  const text = String(message || '').toLowerCase();
  return /\b(stars?|star shop|quests?|chores?|pocket money|rewards?|earned|allowance)\b/.test(text);
}

module.exports = { messageMentionsMeals, messageMentionsShopping, messageMentionsStars };
