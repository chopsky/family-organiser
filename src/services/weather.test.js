/**
 * composeWeatherAnswer - the Haiku pass that turns forecast facts into a
 * direct answer. Contract under test:
 *   1. Sends the question, place, facts and normalised history to the model.
 *   2. Accepts BOTH history shapes: WhatsApp rows ({body, response},
 *      newest-first) and web-chat rows ({role, content}, oldest-first).
 *   3. Fails OPEN: any model error/empty answer returns null so callers
 *      fall back to the raw report - weather must never break.
 */

jest.mock('./ai-client', () => ({
  callClaude: jest.fn(),
  CLAUDE_HAIKU_MODEL: 'claude-haiku-test',
}));

const { callClaude } = require('./ai-client');
const { composeWeatherAnswer } = require('./weather');

const BASE = {
  question: 'Will I need a coat for tomorrow?',
  place: 'London, United Kingdom',
  report: '*Saturday 18 July:*\nOvercast ☁️\n🌡️ 15°–22°C',
};

describe('composeWeatherAnswer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the trimmed model answer and passes question + facts through', async () => {
    callClaude.mockResolvedValue({ text: '  Probably not — it’s mild at 15–22°C. A light layer will do. ' });
    const out = await composeWeatherAnswer(BASE);
    expect(out).toBe('Probably not — it’s mild at 15–22°C. A light layer will do.');
    const call = callClaude.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-test');
    expect(call.messages[0].content).toContain(BASE.question);
    expect(call.messages[0].content).toContain(BASE.place);
    expect(call.messages[0].content).toContain('15°–22°C');
  });

  it('normalises WhatsApp history rows (newest-first {body, response}) oldest-first', async () => {
    callClaude.mockResolvedValue({ text: 'No — 22° and dry.' });
    await composeWeatherAnswer({
      ...BASE,
      question: 'Is that a yes or a no?',
      history: [
        { body: 'Will I need a coat for tomorrow?', response: '📍 London…forecast…' },
        { body: 'add milk to the list', response: 'Done!' },
      ],
    });
    const content = callClaude.mock.calls[0][0].messages[0].content;
    // Oldest first: the milk exchange must appear before the coat question.
    expect(content.indexOf('add milk')).toBeLessThan(content.indexOf('need a coat'));
    expect(content).toContain('User: Will I need a coat for tomorrow?');
    expect(content).toContain('Housemait: 📍 London…forecast…');
  });

  it('normalises web-chat history rows ({role, content})', async () => {
    callClaude.mockResolvedValue({ text: 'Yes — take an umbrella.' });
    await composeWeatherAnswer({
      ...BASE,
      history: [
        { role: 'user', content: 'will it rain later?' },
        { role: 'assistant', content: 'Let me check the weather for you!' },
      ],
    });
    const content = callClaude.mock.calls[0][0].messages[0].content;
    expect(content).toContain('User: will it rain later?');
    expect(content).toContain('Housemait: Let me check the weather for you!');
  });

  it('returns null when the model call throws (caller falls back to the report)', async () => {
    callClaude.mockRejectedValue(new Error('provider down'));
    await expect(composeWeatherAnswer(BASE)).resolves.toBeNull();
  });

  it('returns null on an empty answer', async () => {
    callClaude.mockResolvedValue({ text: '   ' });
    await expect(composeWeatherAnswer(BASE)).resolves.toBeNull();
  });
});
