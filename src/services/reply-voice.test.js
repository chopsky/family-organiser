/**
 * Voice-layer tests: flag gate, happy path, anchor drift, provider failure.
 * ai-client is mocked - no network.
 */
jest.mock('./ai-client', () => ({
  callClaude: jest.fn(),
  CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
}));

const { callClaude } = require('./ai-client');
const { composeVoicedReply } = require('./reply-voice');

const OLD = process.env.BOT_VOICE;
afterEach(() => {
  if (OLD === undefined) delete process.env.BOT_VOICE;
  else process.env.BOT_VOICE = OLD;
  jest.clearAllMocks();
});

const args = {
  facts: { action: 'updated calendar event', item: 'Staying at Nici Bournemouth', what_changed: 'now until Wed 26 Aug' },
  template: '✏️ Updated "Staying at Nici Bournemouth" - now until Wed 26 Aug.',
  anchor: 'Nici Bournemouth',
};

describe('composeVoicedReply', () => {
  test('flag off: null without any model call', async () => {
    delete process.env.BOT_VOICE;
    expect(await composeVoicedReply(args)).toBeNull();
    expect(callClaude).not.toHaveBeenCalled();
  });

  test('flag on: voiced text returned; static system is cache-marked', async () => {
    process.env.BOT_VOICE = '1';
    callClaude.mockResolvedValue({ text: "Done — you're at Nici Bournemouth until Wed 26 Aug now 🏖️" });
    const out = await composeVoicedReply(args);
    expect(out).toMatch(/Nici Bournemouth until Wed 26 Aug/);
    const req = callClaude.mock.calls[0][0];
    expect(req.system[0].cache).toBe(true);
    expect(req.system[0].text).not.toContain('Nici'); // dynamic facts stay out of the cached block
    expect(req.messages[0].content).toContain('Nici');
  });

  test('anchor missing from output → null (template wins)', async () => {
    process.env.BOT_VOICE = '1';
    callClaude.mockResolvedValue({ text: 'All done, updated that for you!' });
    expect(await composeVoicedReply(args)).toBeNull();
  });

  test('provider error → null, never throws', async () => {
    process.env.BOT_VOICE = '1';
    callClaude.mockRejectedValue(new Error('529'));
    expect(await composeVoicedReply(args)).toBeNull();
  });
});
