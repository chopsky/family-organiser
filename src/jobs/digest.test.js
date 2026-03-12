// Mock DB dependencies so the Supabase client isn't initialised during unit tests
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() } }));

const { buildWeeklyDigestMessage } = require('./digest');

const TODAY = new Date().toISOString().split('T')[0];
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split('T')[0];

function makeTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Homework',
    assigned_to_name: 'Jake',
    due_date: TODAY,
    recurrence: 'weekly',
    priority: 'medium',
    completed: false,
    ...overrides,
  };
}

function makeShoppingItem(overrides = {}) {
  return { id: 'item-1', item: 'milk', category: 'groceries', completed: true, ...overrides };
}

const MEMBERS = [
  { id: 'u1', name: 'Sarah', telegram_chat_id: '111' },
  { id: 'u2', name: 'Jake', telegram_chat_id: '222' },
];

describe('buildWeeklyDigestMessage()', () => {
  test('includes household name in heading', () => {
    const msg = buildWeeklyDigestMessage(null, 'The Smiths', [], [], [], [], MEMBERS);
    expect(msg).toContain('The Smiths');
  });

  test('shows completed task and shopping counts', () => {
    const tasks = [makeTask({ completed: true }), makeTask({ completed: true })];
    const shopping = [makeShoppingItem(), makeShoppingItem(), makeShoppingItem()];
    const msg = buildWeeklyDigestMessage(null, 'Family', tasks, shopping, [], [], MEMBERS);
    expect(msg).toContain('2 tasks');
    expect(msg).toContain('3 shopping items');
  });

  test('shows per-person breakdown of completed tasks', () => {
    const tasks = [
      makeTask({ assigned_to_name: 'Jake' }),
      makeTask({ assigned_to_name: 'Jake' }),
      makeTask({ assigned_to_name: 'Sarah' }),
    ];
    const msg = buildWeeklyDigestMessage(null, 'Family', tasks, [], [], [], MEMBERS);
    expect(msg).toContain('Jake: 2 tasks');
    expect(msg).toContain('Sarah: 1 task');
  });

  test('shows outstanding/carrying-over tasks', () => {
    const overdue = makeTask({ title: 'Science project', assigned_to_name: 'Jake', due_date: YESTERDAY });
    const msg = buildWeeklyDigestMessage(null, 'Family', [], [], [overdue], [], MEMBERS);
    expect(msg).toContain('CARRYING OVER');
    expect(msg).toContain('Science project');
    expect(msg).toContain('Jake');
  });

  test('shows all-caught-up message when nothing outstanding', () => {
    const msg = buildWeeklyDigestMessage(null, 'Family', [], [], [], [], MEMBERS);
    expect(msg).toContain('all caught up');
  });

  test('shows upcoming tasks with day names', () => {
    // Create a task due in 2 days
    const twoDaysFromNow = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    const upcoming = makeTask({ title: 'Bins out', recurrence: 'weekly', due_date: twoDaysFromNow, assigned_to_name: null });
    const msg = buildWeeklyDigestMessage(null, 'Family', [], [], [], [upcoming], MEMBERS);
    expect(msg).toContain('COMING UP NEXT WEEK');
    expect(msg).toContain('Bins out');
    expect(msg).toContain('(weekly)');
  });

  test('shows nothing scheduled message when no upcoming tasks', () => {
    const msg = buildWeeklyDigestMessage(null, 'Family', [], [], [], [], MEMBERS);
    expect(msg).toContain('Nothing scheduled');
  });

  test('handles everyone tasks (null assigned_to_name)', () => {
    const everyoneTask = makeTask({ assigned_to_name: null, completed: true });
    const msg = buildWeeklyDigestMessage(null, 'Family', [everyoneTask], [], [], [], MEMBERS);
    expect(msg).toContain('Everyone');
  });

  test('handles singular task wording', () => {
    const tasks = [makeTask()];
    const shopping = [makeShoppingItem()];
    const msg = buildWeeklyDigestMessage(null, 'Family', tasks, shopping, [], [], MEMBERS);
    expect(msg).toContain('1 task,');
    expect(msg).toContain('1 shopping item');
  });

  test('truncates long outstanding list at 8 items', () => {
    const outstanding = Array.from({ length: 12 }, (_, i) =>
      makeTask({ id: `t${i}`, title: `Task ${i}` })
    );
    const msg = buildWeeklyDigestMessage(null, 'Family', [], [], outstanding, [], MEMBERS);
    expect(msg).toContain('and 4 more');
  });
});
