/**
 * Unit tests for the 2026-08-13 capability-gap round on the bot side:
 * recurrence 'none' clears the repeat, and executeBulkModify applies one
 * change to every fuzzy match with a single combined undo.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../services/ai', () => ({}));
jest.mock('../services/broadcast', () => ({ toHousehold: jest.fn() }));

const db = require('../db/queries');
const {
  buildEventUpdates, buildTaskUpdates, executeBulkModify, runUndo, rememberMutation,
} = require('./handlers');

const household = { id: 'h1', timezone: 'Europe/London', members: [{ id: 'u1', name: 'Grant' }] };
const user = { id: 'u1', name: 'Grant' };

beforeEach(() => {
  jest.clearAllMocks();
  db.resolveAssignees.mockImplementation(() => ({ ids: [], names: [] }));
  db.softDeleteCalendarEvent.mockResolvedValue({});
  db.deleteTask.mockResolvedValue({});
  db.deleteShoppingItem.mockResolvedValue({});
  db.updateCalendarEvent.mockResolvedValue({});
  db.updateTask.mockResolvedValue({});
  db.updateShoppingItem.mockResolvedValue({});
  db.restoreDeletedRow.mockResolvedValue({});
});

describe("recurrence 'none' clears the repeat", () => {
  const event = { id: 'e1', title: 'Swimming', start_time: '2026-08-20T16:00:00Z', end_time: '2026-08-20T17:00:00Z', all_day: false, recurrence: 'weekly' };

  test('event updates map none to null', () => {
    const patch = buildEventUpdates({ recurrence: 'none' }, event, household, user);
    expect(patch.recurrence).toBeNull();
  });

  test('event updates keep real recurrence values', () => {
    const patch = buildEventUpdates({ recurrence: 'yearly' }, event, household, user);
    expect(patch.recurrence).toBe('yearly');
  });

  test('task updates map none to null', () => {
    const patch = buildTaskUpdates({ recurrence: 'none' }, { id: 't1', title: 'Bins', recurrence: 'weekly' }, household);
    expect(patch.recurrence).toBeNull();
  });
});

describe('executeBulkModify', () => {
  const fixtures = [
    { id: 'e1', title: 'Fixture: U9 v Rovers', start_time: '2026-09-05T09:00:00Z', end_time: '2026-09-05T10:00:00Z', all_day: false, external_feed_id: null, recurrence: null },
    { id: 'e2', title: 'Fixture: U9 v Town', start_time: '2026-09-12T09:00:00Z', end_time: '2026-09-12T10:00:00Z', all_day: false, external_feed_id: null, recurrence: null },
    { id: 'e3', title: 'Fixture: U9 v City', start_time: '2026-09-19T09:00:00Z', end_time: '2026-09-19T10:00:00Z', all_day: false, external_feed_id: 'feed-1', recurrence: null },
  ];

  test('bulk delete soft-deletes every editable event, skips synced, offers one undo', async () => {
    const res = await executeBulkModify({
      intent: 'delete_event', kind: 'event', candidates: fixtures, updates: {}, user, household, actions: {},
    });
    expect(db.softDeleteCalendarEvent).toHaveBeenCalledTimes(2);
    expect(res.response).toContain('Cancelled 2 events');
    expect(res.response).toContain('synced from another calendar');
    expect(res.response).toContain('undo');
  });

  test('bulk update patches each event against its own date', async () => {
    await executeBulkModify({
      intent: 'update_event', kind: 'event', candidates: fixtures.slice(0, 2),
      updates: { start_time: '14:00' }, user, household, actions: {},
    });
    expect(db.updateCalendarEvent).toHaveBeenCalledTimes(2);
    const [, , patch1] = db.updateCalendarEvent.mock.calls[0];
    const [, , patch2] = db.updateCalendarEvent.mock.calls[1];
    // 2pm London in September (BST) = 13:00 UTC, each on its own day.
    expect(patch1.start_time).toBe('2026-09-05T13:00:00Z');
    expect(patch2.start_time).toBe('2026-09-12T13:00:00Z');
  });

  test('bulk undo restores every item from one reply', async () => {
    await executeBulkModify({
      intent: 'delete_task', kind: 'task',
      candidates: [{ id: 't1', title: 'Pack day 1' }, { id: 't2', title: 'Pack day 2' }],
      updates: {}, user, household, actions: {},
    });
    const undo = await runUndo(user, household);
    expect(db.restoreDeletedRow).toHaveBeenCalledTimes(2);
    expect(undo.response).toContain('all 2 back');
  });

  test('a bulk of only synced events explains read-only instead of pretending', async () => {
    const res = await executeBulkModify({
      intent: 'delete_event', kind: 'event', candidates: [fixtures[2]], updates: {}, user, household, actions: {},
    });
    expect(db.softDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(res.response).toContain("can't change them here");
  });
});
