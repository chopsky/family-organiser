/**
 * Bot handler tests. handlers.js pulls in the DB client + AI/push/broadcast
 * services at import time (all of which need real env/credentials), so we mock
 * that whole chain to a no-op surface. The handler under test takes its db via
 * the module mock, which is all we control here.
 */
jest.mock('../db/queries', () => ({ getCalendarEvents: jest.fn() }));
jest.mock('../services/ai', () => ({
  classify: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(),
  scanImage: jest.fn(), runWebSearch: jest.fn(),
}));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/weather', () => ({
  getWeatherReport: jest.fn(), extractLocationFromMessage: jest.fn(), geocodeLocation: jest.fn(),
}));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn(), REASONING_TIMEOUT_MS: 90000 }));
jest.mock('../services/push', () => ({ sendToHousehold: jest.fn(() => Promise.resolve()) }));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('./calendar-url', () => ({ detectCalendarFeedUrl: jest.fn(() => null), subscribeCalendarFeed: jest.fn() }));
jest.mock('./bulk-extract', () => ({ looksLikeBulkPaste: jest.fn(() => false), extractAndApply: jest.fn() }));
jest.mock('../services/document-extract', () => ({ extractTextFromDocument: jest.fn() }));

const handlers = require('./handlers');
const db = require('../db/queries');

const household = { id: 'h1', timezone: 'Europe/London' };
const user = { id: 'u1', name: 'Grant' };
const TZ = 'Europe/London';

beforeEach(() => jest.clearAllMocks());

describe('handleCalendarQuery', () => {
  test('fetches the EXACT requested range from the DB (no window cap) and lists events', async () => {
    db.getCalendarEvents.mockResolvedValue([
      { title: "Mia's birthday", start_time: '2026-12-14T00:00:00Z', all_day: true, assigned_to_names: [] },
      { title: 'Dentist', start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T09:30:00Z', assigned_to_names: ['Lynn'] },
    ]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31', response_message: 'Here is December:' },
      household, user, TZ, {},
    );
    expect(db.getCalendarEvents).toHaveBeenCalledWith(
      'h1', '2026-12-01T00:00:00Z', '2026-12-31T23:59:59Z',
      expect.objectContaining({ userId: 'u1', birthdays: true }),
    );
    expect(res.response).toContain('Here is December:');
    expect(res.response).toContain("Mia's birthday");
    expect(res.response).toContain('Dentist');
    expect(res.response).toContain('(Lynn)');
  });

  test('defaults to a ~14-day window when no range is supplied', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    await handlers.handleCalendarQuery({}, household, user, TZ, {});
    const [, startArg, endArg] = db.getCalendarEvents.mock.calls[0];
    const days = (new Date(endArg) - new Date(startArg)) / 86400000;
    expect(days).toBeGreaterThan(13.5);
    expect(days).toBeLessThan(15.5);
  });

  test('auto-corrects an inverted range', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    await handlers.handleCalendarQuery({ query_start: '2026-12-01', query_end: '2026-11-01' }, household, user, TZ, {});
    const [, startArg, endArg] = db.getCalendarEvents.mock.calls[0];
    expect(new Date(endArg).getTime()).toBeGreaterThan(new Date(startArg).getTime());
  });

  test('friendly empty-state when nothing is on', async () => {
    db.getCalendarEvents.mockResolvedValue([]);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/nothing on/i);
  });

  test('caps the list at 30 and notes the overflow', async () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      title: `Event ${i}`, start_time: '2026-12-15T09:00:00Z', end_time: '2026-12-15T10:00:00Z', assigned_to_names: [],
    }));
    db.getCalendarEvents.mockResolvedValue(many);
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/and 5 more/);
  });

  test('degrades gracefully when the DB query throws', async () => {
    db.getCalendarEvents.mockRejectedValue(new Error('db down'));
    const res = await handlers.handleCalendarQuery(
      { query_start: '2026-12-01', query_end: '2026-12-31' }, household, user, TZ, {},
    );
    expect(res.response).toMatch(/couldn't pull up your calendar/i);
  });
});
