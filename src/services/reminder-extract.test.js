/**
 * The extractor is the mandatory safety net between "the regexes shrugged"
 * and "the message leaks to full classification" - these tests pin the
 * contract the pending-reminder flow depends on: a clean verdict shape on
 * success, and ALWAYS null on anything malformed or failed (fail-open).
 */

jest.mock('./ai-client', () => ({
  callClaude: jest.fn(),
  CLAUDE_HAIKU_MODEL: 'claude-haiku-test',
}));

const { callClaude } = require('./ai-client');
const { extractReminderOffsets } = require('./reminder-extract');

const reply = (obj) => callClaude.mockResolvedValueOnce({ text: JSON.stringify(obj), usage: null });

describe('extractReminderOffsets verdict contract', () => {
  beforeEach(() => jest.clearAllMocks());

  test('maps a clean answer with remainder', async () => {
    reply({ verdict: 'answer', offsets: [{ time: 7, unit: 'days' }], time_of_day: '', remainder: 'add milk' });
    const v = await extractReminderOffsets('a week before and also add milk', { label: 'Padel' });
    expect(v).toEqual({ verdict: 'answer', offsets: [{ time: 7, unit: 'days' }], timeOfDay: null, remainder: 'add milk' });
  });

  test('valid HH:MM time_of_day passes through; junk becomes null', async () => {
    reply({ verdict: 'answer', offsets: [], time_of_day: '09:00', remainder: '' });
    expect((await extractReminderOffsets('around nine', { itemType: 'task' })).timeOfDay).toBe('09:00');
    reply({ verdict: 'answer', offsets: [], time_of_day: 'nine-ish', remainder: '' });
    expect((await extractReminderOffsets('around nine', { itemType: 'task' })).timeOfDay).toBeNull();
  });

  test('decline and unrelated verdicts survive the mapping', async () => {
    reply({ verdict: 'decline', offsets: [], time_of_day: '', remainder: '' });
    expect((await extractReminderOffsets('no thanks', {})).verdict).toBe('decline');
    reply({ verdict: 'unrelated', offsets: [], time_of_day: '', remainder: '' });
    expect((await extractReminderOffsets('add milk', {})).verdict).toBe('unrelated');
  });

  test('null on an unknown verdict, malformed offsets, or a failed call - never throws', async () => {
    reply({ verdict: 'maybe', offsets: [], time_of_day: '', remainder: '' });
    expect(await extractReminderOffsets('hm', {})).toBeNull();
    reply({ verdict: 'answer', offsets: 'nope', time_of_day: '', remainder: '' });
    expect(await extractReminderOffsets('hm', {})).toBeNull();
    callClaude.mockRejectedValueOnce(new Error('timeout'));
    expect(await extractReminderOffsets('hm', {})).toBeNull();
    expect(await extractReminderOffsets('', {})).toBeNull();
  });
});
