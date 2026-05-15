// Mock DB dependencies so the Supabase client isn't initialised during unit tests
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() } }));

const { buildDailyReminderMessage } = require('./reminders');

const SARAH = { id: 'u1', name: 'Sarah' };

function makeEvent(overrides = {}) {
  return {
    id: 'ev-1',
    title: 'Yoram Strength Training',
    start_time: '2026-05-15T09:30:00.000Z',
    end_time: '2026-05-15T10:30:00.000Z',
    all_day: false,
    assigned_to_name: null,
    assignees: null,
    category: 'general',
    ...overrides,
  };
}

describe('buildDailyReminderMessage()', () => {
  test('includes the user name in the greeting', () => {
    const msg = buildDailyReminderMessage(SARAH, [], 0, []);
    expect(msg).toContain('Sarah');
  });

  test("shows TODAY'S EVENTS section when events exist", () => {
    const ev = makeEvent({ title: 'Garden bin', start_time: '2026-05-15T18:00:00.000Z' });
    // Force UTC so the test isn't sensitive to BST/GMT transitions
    const msg = buildDailyReminderMessage(SARAH, [ev], 0, [], 'UTC');
    expect(msg).toContain("TODAY'S EVENTS");
    expect(msg).toContain('Garden bin');
    expect(msg).toContain('18:00');
  });

  test('shows event assignee in italics when assigned', () => {
    const ev = makeEvent({ title: 'School run', assigned_to_name: 'Ben' });
    const msg = buildDailyReminderMessage(SARAH, [ev], 0, []);
    expect(msg).toContain('School run');
    expect(msg).toContain('Ben');
  });

  test('shows "All day" for all-day events instead of a time', () => {
    const ev = makeEvent({ title: 'Bank holiday', all_day: true, start_time: '2026-05-15T00:00:00.000Z' });
    const msg = buildDailyReminderMessage(SARAH, [ev], 0, []);
    expect(msg).toContain('All day');
    expect(msg).toContain('Bank holiday');
  });

  test('does NOT include a tasks section', () => {
    // Tasks moved to the later-in-day nudge — morning message should
    // never mention them.
    const ev = makeEvent({ title: 'Anything' });
    const msg = buildDailyReminderMessage(SARAH, [ev], 0, []);
    expect(msg).not.toContain('YOUR TASKS');
    expect(msg).not.toContain('HOUSEHOLD TASKS');
  });

  test('shows shopping count when items exist', () => {
    const msg = buildDailyReminderMessage(SARAH, [], 7, []);
    expect(msg).toContain('7 items');
    expect(msg).toContain('/shopping');
  });

  test('shows singular "item" for count of 1', () => {
    const msg = buildDailyReminderMessage(SARAH, [], 1, []);
    expect(msg).toContain('1 item on the list');
  });

  test('shows all done message when shopping list is empty', () => {
    const msg = buildDailyReminderMessage(SARAH, [], 0, []);
    expect(msg).toContain('List is empty');
  });

  test('shows "nothing scheduled" when no events AND no school', () => {
    const msg = buildDailyReminderMessage(SARAH, [], 0, []);
    expect(msg).toContain('Nothing scheduled today');
  });
});
