// Mock DB dependencies so the Supabase client isn't initialised during unit tests
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() } }));

const { buildDailyReminderMessage } = require('./reminders');

const TODAY = new Date().toISOString().split('T')[0];
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

const SARAH = { id: 'u1', name: 'Sarah' };

function makeTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Buy groceries',
    assigned_to_name: null,
    due_date: TODAY,
    recurrence: null,
    priority: 'medium',
    ...overrides,
  };
}

describe('buildDailyReminderMessage()', () => {
  test('includes the user name in the greeting', () => {
    const msg = buildDailyReminderMessage(SARAH, [], [], 0);
    expect(msg).toContain('Sarah');
  });

  test('shows personal tasks section when there are tasks', () => {
    const task = makeTask({ title: 'Call the dentist', assigned_to_name: 'Sarah', due_date: TODAY });
    const msg = buildDailyReminderMessage(SARAH, [task], [], 0);
    expect(msg).toContain('YOUR TASKS');
    expect(msg).toContain('Call the dentist');
  });

  test('marks overdue tasks with red circle and days overdue', () => {
    const task = makeTask({ title: 'Take dog to vet', due_date: TWO_DAYS_AGO });
    const msg = buildDailyReminderMessage(SARAH, [task], [], 0);
    expect(msg).toContain('🔴');
    expect(msg).toContain('overdue by 2 day');
  });

  test('marks due-today tasks with yellow circle', () => {
    const task = makeTask({ title: 'Pick up prescription', due_date: TODAY });
    const msg = buildDailyReminderMessage(SARAH, [task], [], 0);
    expect(msg).toContain('🟡');
    expect(msg).toContain('due today');
  });

  test('shows household (everyone) tasks separately', () => {
    const everyoneTask = makeTask({ title: 'Put bins out', recurrence: 'weekly' });
    const msg = buildDailyReminderMessage(SARAH, [], [everyoneTask], 0);
    expect(msg).toContain('HOUSEHOLD TASKS');
    expect(msg).toContain('Put bins out');
    expect(msg).toContain('[weekly]');
  });

  test('shows shopping count when items exist', () => {
    const msg = buildDailyReminderMessage(SARAH, [], [], 7);
    expect(msg).toContain('7 items');
    expect(msg).toContain('/shopping');
  });

  test('shows singular "item" for count of 1', () => {
    const msg = buildDailyReminderMessage(SARAH, [], [], 1);
    expect(msg).toContain('1 item on the list');
  });

  test('shows all done message when shopping list is empty', () => {
    const msg = buildDailyReminderMessage(SARAH, [], [], 0);
    expect(msg).toContain('List is empty');
  });

  test('shows nothing due message when no tasks', () => {
    const msg = buildDailyReminderMessage(SARAH, [], [], 0);
    expect(msg).toContain('Nothing due today');
  });

  test('includes recurrence tag for recurring tasks', () => {
    const task = makeTask({ title: 'Homework', recurrence: 'weekly', due_date: TODAY });
    const msg = buildDailyReminderMessage(SARAH, [task], [], 0);
    expect(msg).toContain('[weekly]');
  });
});
