/**
 * Heuristic: does this user message warrant sending the household's
 * home address to the AI provider?
 *
 * Used by both the in-app chat (chat.js) and the WhatsApp/classify
 * flow (ai.js) to gate inclusion of the precise address in the system
 * prompt. When the heuristic says "no", the AI still gets a coarse
 * timezone-derived city for general locale context - it just doesn't
 * see the household's specific street and postcode unless the user is
 * actually asking about somewhere local.
 *
 * Design: false-positive bias is acceptable (sending the address on a
 * loosely-related question costs nothing extra), false-negative bias
 * is the real cost (user asks for a restaurant, AI gives generic
 * advice because we withheld location). So the keyword list is
 * intentionally generous on the recall side.
 *
 * Returns true when ANY of these match in the message:
 *   - Proximity words ("near", "nearby", "close to", "around here", …)
 *   - Place categories typically asked about with local intent
 *     (restaurant, GP, doctor, dentist, pub, café, shop, park, gym, …)
 *   - Recommendation phrasing tied to places ("where can I get…",
 *     "any good <X>", "recommend a <X>")
 *   - Outing / weekend phrasing ("day trip", "weekend activity",
 *     "family-friendly")
 *
 * Does NOT match for things like "what's on my calendar today" or
 * "remind me to call the bank" - those have no plausible reason to
 * need the precise home location.
 */
function messageMentionsLocation(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.toLowerCase();

  // Proximity words - direct asks for nearby things.
  if (/\b(near|nearby|close[\s-]?by|locally|around (here|me|us)|in (my|our) (area|neighbour?hood|postcode|town)|walking distance|drive away|drive to|down the road|round the corner)\b/.test(text)) return true;
  if (/\bnear (me|home|us|here|by)\b/.test(text)) return true;

  // Place categories that imply "find me one of these somewhere I can
  // actually go". Bare mentions ("restaurant", "GP") are enough - we'd
  // rather over-send and have the AI quote a useful place than
  // under-send and have it shrug.
  if (/\b(restaurants?|caf(é|e)s?|coffee shop|coffee place|pubs?|bars?|takeaways?|takeouts?|gp|gp surgery|doctors?|dentists?|opticians?|vets?|pharmac(y|ies)|hospitals?|clinics?|parks?|playgrounds?|gardens?|gyms?|swimming pool|leisure centre|museums?|libraries|cinemas?|theatres?|theaters?|shops?|stores?|supermarkets?|markets?|hairdressers?|barbers?|salons?|spas?|nail salon)\b/.test(text)) return true;

  // Recommendation phrasing that's clearly about *where*, not *what*.
  if (/\bwhere (can|should|would|do)\b/.test(text)) return true;
  if (/\bwhere to (go|eat|drink|take|find|get|buy|visit|see|stay|sit|grab|hang|meet)\b/.test(text)) return true;
  if (/\brecommend (a|an|some|any)\b/.test(text)) return true;
  if (/\bsuggest (a|an|some|any)\b/.test(text)) return true;
  if (/\bany good\b/.test(text)) return true;

  // Outing / weekend / kids-activity phrasing.
  if (/\b(weekend (plans?|activit(y|ies))|day trip|day out|things to do|family[\s-]?friendly|kids[\s-]?friendly|date night)\b/.test(text)) return true;

  return false;
}

module.exports = { messageMentionsLocation };
