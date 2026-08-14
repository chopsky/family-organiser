/**
 * Pasted-schedule events must store UTC instants converted from the
 * household timezone - the same naive-string bug as the email-forward
 * path (567c146), found on this path via Maxine's dog groomer
 * appointments landing an hour late (2026-08-14).
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');

const db = require('../db/queries');
const { applyExtraction } = require('./bulk-extract');

const user = { id: 'u1', name: 'Maxine' };
const household = { id: 'h1', timezone: 'Europe/London', members: [] };

beforeEach(() => {
  jest.clearAllMocks();
  db.resolveAssignees.mockReturnValue({ ids: [], names: [] });
  db.createCalendarEvent.mockImplementation(async (hh, ev) => ({ id: 'e1', ...ev }));
  db.saveEventAssignees.mockResolvedValue([]);
});

describe('applyExtraction event timezone conversion', () => {
  test('BST wall-clock times store as the UTC instant', async () => {
    await applyExtraction({
      events: [{ title: 'Toffee grooming', date: '2026-08-15', start_time: '11:30', end_time: '12:30', all_day: false }],
    }, user, household);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    // 11:30am London in August (BST, UTC+1) = 10:30 UTC.
    expect(stored.start_time).toBe('2026-08-15T10:30:00Z');
    expect(stored.end_time).toBe('2026-08-15T11:30:00Z');
  });

  test('winter (GMT) times store unshifted', async () => {
    await applyExtraction({
      events: [{ title: 'Vet', date: '2026-12-10', start_time: '09:00', all_day: false }],
    }, user, household);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    expect(stored.start_time).toBe('2026-12-10T09:00:00Z');
  });

  test('all-day events keep the naive date-only convention', async () => {
    await applyExtraction({
      events: [{ title: 'INSET day', date: '2026-09-01', all_day: true }],
    }, user, household);
    const stored = db.createCalendarEvent.mock.calls[0][1];
    expect(stored.start_time).toBe('2026-09-01T00:00:00');
    expect(stored.end_time).toBe('2026-09-01T23:59:59');
  });
});
