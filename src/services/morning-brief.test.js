// Mock the AI client so we can drive the success + failure paths
// deterministically without a real LLM call.
jest.mock('./ai-client', () => ({ callWithFailover: jest.fn() }));
const { callWithFailover } = require('./ai-client');
const { generateMorningBriefPush, clampBody, fallbackBody } = require('./morning-brief');

describe('clampBody', () => {
  test('collapses whitespace and leaves short text intact', () => {
    expect(clampBody('Morning   Grant!\n\nClear   day.')).toBe('Morning Grant! Clear day.');
  });

  test('trims to a sentence boundary when over the limit', () => {
    const long = 'First sentence here. Second sentence that pushes well past the cap and keeps going on and on.';
    const out = clampBody(long, 30);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out).toBe('First sentence here.');
  });

  test('falls back to a word boundary with an ellipsis', () => {
    const out = clampBody('Supercalifragilistic expialidocious extra words here', 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
});

describe('fallbackBody', () => {
  test('quiet day reassures rather than listing nothing', () => {
    const out = fallbackBody('Grant', { eventCount: 0, taskCount: 0, billCount: 0 });
    expect(out).toMatch(/Grant/);
    expect(out).not.toMatch(/0 /); // never "0 things"
  });

  test('busy day summarises counts with correct pluralisation', () => {
    const out = fallbackBody('Lynn', { eventCount: 1, taskCount: 2, billCount: 0 });
    expect(out).toMatch(/1 thing on your calendar/);
    expect(out).toMatch(/2 tasks/);
    expect(out).not.toMatch(/bill/);
  });
});

describe('generateMorningBriefPush', () => {
  afterEach(() => jest.clearAllMocks());

  test('uses the LLM text when generation succeeds (and clamps it)', async () => {
    callWithFailover.mockResolvedValue({ text: '  "Morning Grant! Clear calendar today."  ' });
    const { title, body } = await generateMorningBriefPush(
      { name: 'Grant Shapiro', weekday: 'Wednesday', summary: '📅 Dentist 09:00', counts: { eventCount: 1 } },
      { householdId: 'h1', userId: 'u1' },
    );
    expect(title).toBe('Morning briefing');
    expect(body).toBe('Morning Grant! Clear calendar today.'); // quotes stripped
    // First name only is passed to the model
    const sentPrompt = callWithFailover.mock.calls[0][0].messages[0].content;
    expect(sentPrompt).toMatch(/Grant/);
    expect(sentPrompt).not.toMatch(/Shapiro/);
  });

  test('falls back to deterministic copy when the LLM throws', async () => {
    callWithFailover.mockRejectedValue(new Error('all providers down'));
    const { body } = await generateMorningBriefPush(
      { name: 'Grant', weekday: 'Wednesday', summary: '', counts: { eventCount: 0, taskCount: 0, billCount: 0 } },
      {},
    );
    expect(body).toMatch(/Grant/);
    expect(body.length).toBeGreaterThan(0);
  });

  test('falls back when the LLM returns empty text', async () => {
    callWithFailover.mockResolvedValue({ text: '   ' });
    const { body } = await generateMorningBriefPush(
      { name: 'Lynn', summary: '', counts: { eventCount: 3 } },
      {},
    );
    expect(body).toMatch(/Lynn/);
    expect(body).toMatch(/3 things/);
  });
});
