/**
 * The gratitude-moment review ask: detection strictness, the once-ever
 * stamp, platform-correct links, and the never-throw contract.
 */

jest.mock('../db/queries', () => ({
  getActiveDeviceTokens: jest.fn(),
  markReviewAskIfUnsent: jest.fn(),
}));

const db = require('../db/queries');
const { maybeAppendReviewAsk, detectGratitude, reviewLink } = require('./review-ask');

const user = { id: 'u-1' };
const REPLY = 'Anytime! 😊';

describe('detectGratitude', () => {
  test.each([
    'Thanks so much!',
    'thank you',
    'thankyou!!',
    'cheers',
    'ta',
    "you're a lifesaver",
    'this is amazing 🙏',
    'Love this',
    'absolutely brilliant',
    'wow, incredible!',
    'best app ever',
  ])('matches pure gratitude: %s', (t) => {
    expect(detectGratitude(t)).toBe(true);
  });

  test.each([
    'thanks, also add milk',            // gratitude + an instruction
    'perfect',                          // mid-flow confirmation
    'great',
    'ok thanks can you move swimming to 5pm',
    'add spaghetti to the meal plan',
    'what a nightmare of a day, thanks for nothing school admin - anyway add PE kit reminder', // > MAX_LEN
    '',
  ])('rejects non-gratitude or mixed: %s', (t) => {
    expect(detectGratitude(t)).toBe(false);
  });
});

describe('maybeAppendReviewAsk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.getActiveDeviceTokens.mockResolvedValue([{ platform: 'ios' }]);
    db.markReviewAskIfUnsent.mockResolvedValue(true);
  });

  test('appends the iOS link once for a first-time thanks', async () => {
    const out = await maybeAppendReviewAsk({ user, text: 'thanks so much!', intent: 'trivial', reply: REPLY });
    expect(out).toContain(REPLY);
    expect(out).toContain('apps.apple.com');
    expect(out).toContain('write-review');
    expect(db.markReviewAskIfUnsent).toHaveBeenCalledWith('u-1');
  });

  test('android device gets the Play link', async () => {
    db.getActiveDeviceTokens.mockResolvedValue([{ platform: 'android' }]);
    const out = await maybeAppendReviewAsk({ user, text: 'cheers!', intent: 'trivial', reply: REPLY });
    expect(out).toContain('play.google.com');
  });

  test('already-stamped user gets nothing (once ever)', async () => {
    db.markReviewAskIfUnsent.mockResolvedValue(false);
    const out = await maybeAppendReviewAsk({ user, text: 'thanks!', intent: 'trivial', reply: REPLY });
    expect(out).toBe(REPLY);
  });

  test('pre-migration stamp throw skips silently and keeps the reply', async () => {
    db.markReviewAskIfUnsent.mockRejectedValue(new Error('column users.review_ask_sent_at does not exist'));
    const out = await maybeAppendReviewAsk({ user, text: 'thanks!', intent: 'trivial', reply: REPLY });
    expect(out).toBe(REPLY);
  });

  test('no active device: no ask AND the lifetime stamp is not spent', async () => {
    db.getActiveDeviceTokens.mockResolvedValue([]);
    const out = await maybeAppendReviewAsk({ user, text: 'thanks!', intent: 'trivial', reply: REPLY });
    expect(out).toBe(REPLY);
    expect(db.markReviewAskIfUnsent).not.toHaveBeenCalled();
  });

  test('chain intents never trigger, even on gratitude-shaped text', async () => {
    const out = await maybeAppendReviewAsk({ user, text: 'thanks!', intent: 'modify_confirm', reply: 'Moved it to 5pm.' });
    expect(out).toBe('Moved it to 5pm.');
    expect(db.markReviewAskIfUnsent).not.toHaveBeenCalled();
  });

  test('never appends when the bot is asking a question', async () => {
    const out = await maybeAppendReviewAsk({ user, text: 'amazing!', intent: 'trivial', reply: 'Glad it helped! Want me to set that weekly?' });
    expect(out).toBe('Glad it helped! Want me to set that weekly?');
  });
});

describe('reviewLink', () => {
  test('per-platform links, null when unknown', () => {
    expect(reviewLink('ios')).toContain('action=write-review');
    expect(reviewLink('android')).toContain('com.housemait.app');
    expect(reviewLink(null)).toBeNull();
  });
});
