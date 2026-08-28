/**
 * The gratitude-moment review ask (WhatsApp).
 *
 * When a user sends the bot pure gratitude ("thanks so much!", "you're a
 * lifesaver"), that is the warmest instant in the product - so the reply
 * may carry, ONCE PER USER EVER, a PS asking for a store review.
 *
 * Hard rules, in order:
 *  - The inbound message must be gratitude and nothing else: a strict
 *    whole-message regex over a short text. "thanks, also add milk" never
 *    triggers (it isn't a pure-gratitude message, and the reply belongs
 *    to the milk).
 *  - Never on a chain turn (the user is answering a bot question - a
 *    bare "perfect" mid-flow is a confirmation, not applause) and never
 *    when the outgoing reply asks its own question.
 *  - The link matches the user's store, resolved from their active
 *    device tokens. No known device -> no ask AND no stamp: the one
 *    lifetime shot is not spent on someone who cannot review.
 *  - Once ever is a DB stamp (users.review_ask_sent_at) claimed with an
 *    atomic conditional update - never an in-memory flag (the evening-
 *    brief deploy-wipe lesson). Pre-migration the claim throws and the
 *    ask is skipped: no stamp = repeat risk = worse than waiting.
 *
 * Apple/Play compliance: user-initiated moment, plain link, no incentive,
 * no gating - the same rules as the Settings row and the wins engine.
 */

const db = require('../db/queries');
const { APP_STORE_ID, PLAY_PACKAGE_ID } = require('../utils/store-ids');

// Whole-message gratitude, matched with apostrophes stripped ("you're" ->
// "youre"). Optional exclamation lead-in, optional "this is / you're"
// style subject, then a gratitude core, then only punctuation/emoji.
// Bare "great"/"perfect"/"ok" are deliberately NOT cores - they are
// mid-flow confirmations more often than applause.
const GRATITUDE_RE = new RegExp(
  '^(?:(?:wow|omg|oh wow|ah+|aw+)[,!\\s]*)?' +
  '(?:(?:this|that|it)(?:\\s+app)?(?:\\s+is|s)?\\s+|youre\\s+|you are\\s+|ur\\s+|so\\s+)?' +
  '(?:absolutely\\s+|really\\s+|such\\s+an?\\s+|an?\\s+|the\\s+)?' +
  '(?:amazing|brilliant|incredible|fantastic|wonderful|magic(?:al)?|' +
  'life\\s*saver|legend|best(?:\\s+app(?:\\s+ever)?)?|so\\s+good|' +
  'love\\s+(?:it|this|housemait)|' +
  'thank(?:s|\\s*you)(?:\\s+(?:so\\s+much|a\\s+lot|again|for\\s+this))?|thx|ty|cheers|ta)' +
  '[\\s!.,\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]*$',
  'iu',
);

const MAX_LEN = 48;

function detectGratitude(text) {
  // Strip apostrophes ("you're" -> "youre") and emoji variation
  // selectors (❤️ = U+2764 U+FE0F; the base char is already in the
  // trailing class, the selector would break the $ anchor).
  const t = String(text || '').trim().replace(/'|\u2019|\uFE0F/g, '');
  if (!t || t.length > MAX_LEN) return false;
  return GRATITUDE_RE.test(t);
}

function reviewLink(platform) {
  if (platform === 'ios') return `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
  if (platform === 'android') return `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE_ID}`;
  return null;
}

// Chain/system turns where a gratitude-looking message is really a flow
// reply (mirrors the webhook's METER_CHAIN_INTENTS shape).
const SKIP_INTENTS = /^(reminder_|birthday_recurrence|duplicate_todo|invite_link_reply|modify_confirm|school_|term_dates_import|brief_|meter_)/;

/**
 * Returns the decorated reply (or the original, untouched). Never throws.
 */
async function maybeAppendReviewAsk({ user, text, intent, reply }) {
  try {
    if (!user?.id || !reply) return reply;
    if (intent && SKIP_INTENTS.test(intent)) return reply;
    if (/\?\s*$/.test(reply)) return reply; // the bot is mid-question
    if (!detectGratitude(text)) return reply;

    const tokens = await db.getActiveDeviceTokens(user.id).catch(() => []);
    const platforms = [...new Set((tokens || []).map((t) => t.platform))];
    const platform = platforms.includes('ios') ? 'ios' : platforms.includes('android') ? 'android' : null;
    const link = reviewLink(platform);
    if (!link) return reply; // no store to review in - keep the lifetime shot

    const won = await db.markReviewAskIfUnsent(user.id); // throws pre-migration -> catch below
    if (!won) return reply;

    return `${reply}\n\nPS - so glad it's helping 💜 If you've got 30 seconds, a quick review genuinely helps other families find us: ${link}`;
  } catch (err) {
    console.warn('[review-ask] skipped:', err.message);
    return reply;
  }
}

module.exports = { maybeAppendReviewAsk, detectGratitude, reviewLink };
