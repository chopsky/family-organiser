/**
 * Deterministic handler tests for the bot-routing changes:
 *  - parseTimeOfDay (pure time-of-day parser)
 *  - graduateAppointmentTodo (appointment "to-do → calendar" tick-off)
 *  - the reminder follow-up resolve (the "Yes 1 hour before" bug fix)
 *
 * handlers.js pulls the DB client + AI/push/broadcast services in at import
 * time, so we mock that whole chain (same surface as handlers.test.js) and
 * drive the handler via the module mock.
 */
jest.mock('../db/queries', () => ({
  findTasksByFuzzyTitle: jest.fn(() => Promise.resolve([])),
  completeTask: jest.fn((id) => Promise.resolve({ id })),
  updateTask: jest.fn((id, hid, patch) => Promise.resolve({ id, ...patch })),
  saveEventReminders: jest.fn(() => Promise.resolve()),
  resolveAssignees: jest.fn(() => ({ ids: [], names: [] })),
}));
jest.mock('../services/ai', () => ({ classify: jest.fn(), scanReceipt: jest.fn(), matchReceiptToList: jest.fn(), scanImage: jest.fn(), runWebSearch: jest.fn() }));
jest.mock('../services/transcribe', () => ({ transcribeVoice: jest.fn() }));
jest.mock('../services/weather', () => ({ getWeatherReport: jest.fn(), extractLocationFromMessage: jest.fn(), geocodeLocation: jest.fn() }));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn(), REASONING_TIMEOUT_MS: 90000 }));
jest.mock('../services/push', () => ({ sendToHousehold: jest.fn(() => Promise.resolve()) }));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));
jest.mock('./calendar-url', () => ({ detectCalendarFeedUrl: jest.fn(() => null), subscribeCalendarFeed: jest.fn() }));
jest.mock('./bulk-extract', () => ({ looksLikeBulkPaste: jest.fn(() => false), looksLikeSchoolTermDates: jest.fn(() => false), extractAndApply: jest.fn() }));
jest.mock('../services/document-extract', () => ({ extractTextFromDocument: jest.fn() }));
jest.mock('../services/term-date-extract', () => ({ extractTermDatesPreview: jest.fn(), academicYearsForCountry: jest.fn(() => ({ currentAY: '2025-2026', nextAY: '2026-2027' })) }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));

const handlers = require('./handlers');
const db = require('../db/queries');

const household = { id: 'h1', timezone: 'Europe/London', members: [{ id: 'm1', name: 'Grant' }, { id: 'm2', name: 'James' }] };
const user = { id: 'u1', name: 'Grant' };
const emptyActions = () => ({ shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] });

beforeEach(() => jest.clearAllMocks());

describe('parseTimeOfDay', () => {
  test.each([
    ['9am', '09:00'], ['9 am', '09:00'], ['9:30am', '09:30'], ['3pm', '15:00'],
    ['at 3pm', '15:00'], ['12pm', '12:00'], ['12am', '00:00'], ['noon', '12:00'],
    ['midnight', '00:00'], ['15:00', '15:00'], ['9:05 pm', '21:05'],
  ])('parses "%s" → %s', (input, expected) => {
    expect(handlers.parseTimeOfDay(input)).toBe(expected);
  });

  test.each(['1 hour before', '30 minutes before', '2 days before', '9', 'at 9', 'tomorrow', ''])(
    'does NOT misfire on offset/ambiguous "%s"', (input) => {
      expect(handlers.parseTimeOfDay(input)).toBeNull();
    });
});

describe('graduateAppointmentTodo', () => {
  test('unique "Book X appointment" to-do is ticked off', async () => {
    db.findTasksByFuzzyTitle.mockResolvedValue([{ id: 't1', title: 'Book dentist appointment' }]);
    const actions = emptyActions();
    const ticked = await handlers.graduateAppointmentTodo('Dentist appointment', household, actions);
    expect(ticked).toBe('Book dentist appointment');
    expect(db.completeTask).toHaveBeenCalledWith('t1');
    expect(actions.tasksCompleted).toContain('Book dentist appointment');
  });

  test('multi-word noun: "Car service" ticks "Book car service"', async () => {
    db.findTasksByFuzzyTitle.mockResolvedValue([{ id: 't9', title: 'Book car service' }]);
    expect(await handlers.graduateAppointmentTodo('Car service', household, emptyActions())).toBe('Book car service');
  });

  test('ambiguous (two booking matches) → does nothing', async () => {
    db.findTasksByFuzzyTitle.mockResolvedValue([
      { id: 't1', title: 'Book dentist appointment' },
      { id: 't2', title: 'Book dentist follow-up' },
    ]);
    expect(await handlers.graduateAppointmentTodo('Dentist appointment', household, emptyActions())).toBeNull();
    expect(db.completeTask).not.toHaveBeenCalled();
  });

  test('non-booking match (no scheduling verb) → does nothing', async () => {
    db.findTasksByFuzzyTitle.mockResolvedValue([{ id: 't1', title: 'Dentist paperwork' }]);
    expect(await handlers.graduateAppointmentTodo('Dentist appointment', household, emptyActions())).toBeNull();
    expect(db.completeTask).not.toHaveBeenCalled();
  });

  test('no candidate booking to-do → does nothing', async () => {
    db.findTasksByFuzzyTitle.mockResolvedValue([]);
    expect(await handlers.graduateAppointmentTodo("James's football match", household, emptyActions())).toBeNull();
  });
});

describe('reminder follow-up (the "Yes 1 hour before" fix)', () => {
  test('event + offset → saves an event reminder', async () => {
    handlers.rememberReminderTarget('u1', { itemId: 'e1', itemType: 'event', householdId: 'h1', label: 'Dentist', startTime: '2026-07-07T15:00:00Z' });
    const res = await handlers.handleTextMessage('1 hour before', user, household, {});
    expect(db.saveEventReminders).toHaveBeenCalledWith('e1', 'h1', [{ time: 1, unit: 'hours' }], '2026-07-07T15:00:00Z');
    expect(res.response).toMatch(/remind you/i);
  });

  test('to-do WITH a due time + offset → sets the notification enum (no error)', async () => {
    handlers.rememberReminderTarget('u1', { itemId: 't1', itemType: 'task', householdId: 'h1', label: 'Pay bill', dueTime: '17:00' });
    const res = await handlers.handleTextMessage('30 minutes before', user, household, {});
    expect(db.updateTask).toHaveBeenCalledWith('t1', 'h1', expect.objectContaining({ notification: '30_min' }));
    expect(res.response).not.toMatch(/didn't see any field/i);
  });

  test('date-only to-do + offset → asks for a time (honest), keeps the target', async () => {
    handlers.rememberReminderTarget('u1', { itemId: 't2', itemType: 'task', householdId: 'h1', label: 'Take the bins out', dueTime: null });
    const res = await handlers.handleTextMessage('1 hour before', user, household, {});
    expect(db.updateTask).not.toHaveBeenCalled();
    expect(res.response).toMatch(/what time/i);
    const still = handlers.popReminderTarget('u1');
    expect(still?.pendingOffset).toEqual({ time: 1, unit: 'hours' });
  });

  test('date-only to-do + a time → sets due_time + the offset, so it can fire', async () => {
    handlers.rememberReminderTarget('u1', { itemId: 't3', itemType: 'task', householdId: 'h1', label: 'Take the bins out', dueTime: null, pendingOffset: { time: 1, unit: 'hours' } });
    const res = await handlers.handleTextMessage('9am', user, household, {});
    expect(db.updateTask).toHaveBeenCalledWith('t3', 'h1', expect.objectContaining({ due_time: '09:00', notification: '1_hour' }));
    expect(res.response).toMatch(/9:00 am/);
  });

  test('the old "didn\'t see any field to change" error is gone', async () => {
    handlers.rememberReminderTarget('u1', { itemId: 't4', itemType: 'task', householdId: 'h1', label: 'X', dueTime: '08:00' });
    const res = await handlers.handleTextMessage('Yes 1 hour before', user, household, {});
    expect(res.response).not.toMatch(/didn't see any field/i);
  });
});
