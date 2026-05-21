// Mock DB dependencies so the Supabase client isn't initialised during unit tests
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() } }));

const { buildDailyReminderMessage } = require('./reminders');

const SARAH = { id: 'u1', name: 'Sarah' };

// Normalise the singular-assignee fixture shape (legacy) into the new
// assigned_to_names array. Tests that pass assigned_to_name: 'Ben' are
// transparently upgraded so the reminder renderer (which reads the new
// field) still sees the expected name.
function makeEvent(overrides = {}) {
  let names;
  if ('assigned_to_names' in overrides) {
    names = overrides.assigned_to_names || [];
  } else if ('assigned_to_name' in overrides) {
    names = overrides.assigned_to_name ? [overrides.assigned_to_name] : [];
  } else {
    names = [];
  }
  const { assigned_to_name: _ignored, ...rest } = overrides;
  return {
    id: 'ev-1',
    title: 'Yoram Strength Training',
    start_time: '2026-05-15T09:30:00.000Z',
    end_time: '2026-05-15T10:30:00.000Z',
    all_day: false,
    assigned_to_names: names,
    assignees: null,
    category: 'general',
    ...rest,
    assigned_to_names: names,
  };
}

describe('buildDailyReminderMessage()', () => {
  test('includes the user name + weekday in the greeting', () => {
    const msg = buildDailyReminderMessage(SARAH, { tz: 'UTC' });
    expect(msg).toContain('Sarah');
    // Weekday computed from "now", so just check the prefix - the exact
    // day depends on when the test runs, but the format is fixed.
    expect(msg).toMatch(/Good (morning|afternoon|evening), Sarah! Here's your \w+:/);
  });

  test("shows Today's Schedule section when timed events exist", () => {
    const ev = makeEvent({ title: 'Garden bin', start_time: '2026-05-15T18:00:00.000Z' });
    // Force UTC so the test isn't sensitive to BST/GMT transitions
    const msg = buildDailyReminderMessage(SARAH, { todayEvents: [ev], tz: 'UTC' });
    expect(msg).toContain("Today's Schedule:");
    expect(msg).toContain('Garden bin');
    expect(msg).toContain('18:00');
    // No bullets in the schedule lines per the redesign.
    expect(msg).not.toContain('• 18:00');
  });

  test('shows event assignee in italics when assigned', () => {
    const ev = makeEvent({ title: 'School run', assigned_to_name: 'Ben' });
    const msg = buildDailyReminderMessage(SARAH, { todayEvents: [ev] });
    expect(msg).toContain('School run');
    expect(msg).toContain('Ben');
  });

  test('all-day events render with "All day -" prefix', () => {
    // Per the user's follow-up: every event should appear, all-day or
    // not. All-day rows lead with "All day -" instead of a time.
    const allDay = makeEvent({ title: 'Class photos', all_day: true, start_time: '2026-05-15T00:00:00.000Z' });
    const msg = buildDailyReminderMessage(SARAH, { todayEvents: [allDay] });
    expect(msg).toContain("Today's Schedule:");
    expect(msg).toContain('All day - Class photos');
  });

  test('all-day events render before timed events in the schedule', () => {
    const allDay = makeEvent({ title: 'Class photos', all_day: true, start_time: '2026-05-15T00:00:00.000Z' });
    const timed = makeEvent({ id: 'ev-2', title: 'Logan OT', start_time: '2026-05-15T08:00:00.000Z', all_day: false });
    const msg = buildDailyReminderMessage(SARAH, { todayEvents: [allDay, timed], tz: 'UTC' });
    const allDayIdx = msg.indexOf('Class photos');
    const timedIdx = msg.indexOf('Logan OT');
    expect(allDayIdx).toBeGreaterThan(-1);
    expect(timedIdx).toBeGreaterThan(-1);
    expect(allDayIdx).toBeLessThan(timedIdx);
  });

  test('does NOT include a tasks section header', () => {
    // Tasks-due-today/tomorrow go in the new Reminders block, not a
    // standalone "YOUR TASKS" section. Old header strings are gone.
    const ev = makeEvent({ title: 'Anything' });
    const msg = buildDailyReminderMessage(SARAH, { todayEvents: [ev] });
    expect(msg).not.toContain('YOUR TASKS');
    expect(msg).not.toContain('HOUSEHOLD TASKS');
    expect(msg).not.toContain("TODAY'S EVENTS"); // old header replaced too
  });

  test('shows shopping count when items exist', () => {
    const msg = buildDailyReminderMessage(SARAH, { shoppingCount: 7 });
    expect(msg).toContain('7 items on the shopping list');
    // The "Reply /shopping to see it." CTA was removed per user feedback -
    // the count alone is the whole message.
    expect(msg).not.toContain('/shopping');
  });

  test('shows singular "item" for count of 1', () => {
    const msg = buildDailyReminderMessage(SARAH, { shoppingCount: 1 });
    expect(msg).toContain('1 item on the shopping list');
  });

  test('omits the shopping line entirely when count is 0', () => {
    // Redesign: no "List is empty - all done!" filler when the
    // shopping list is empty. Just don't say anything.
    const msg = buildDailyReminderMessage(SARAH, { shoppingCount: 0 });
    expect(msg).not.toContain('List is empty');
    expect(msg).not.toContain('shopping list');
  });

  test('shows "nothing scheduled" when no events AND no school', () => {
    const msg = buildDailyReminderMessage(SARAH, {});
    expect(msg).toContain('Nothing scheduled today');
  });

  test('shows the dinner line when a meal plan entry is present', () => {
    const msg = buildDailyReminderMessage(SARAH, {
      dinner: { meal_name: 'Beef tacos', cook_time_mins: 25 },
    });
    expect(msg).toContain('🍽️ Dinner: Beef tacos');
    expect(msg).toContain('25 min');
  });

  test('dinner line omits cook time when recipe has none', () => {
    const msg = buildDailyReminderMessage(SARAH, {
      dinner: { meal_name: 'Leftovers', cook_time_mins: null },
    });
    expect(msg).toContain('Dinner: Leftovers');
    expect(msg).not.toContain('min'); // no cook-time suffix
  });

  test('omits the dinner section entirely when no meal is planned', () => {
    const msg = buildDailyReminderMessage(SARAH, {});
    expect(msg).not.toContain('Dinner');
    expect(msg).not.toContain('🍽️');
  });

  test('shows Reminders block with bullets for tasks + bills', () => {
    const msg = buildDailyReminderMessage(SARAH, {
      taskReminders: [
        { title: "Mason's permission slip", when: 'today' },
      ],
      billReminders: [
        { name: 'Electric bill', when: 'tomorrow' },
      ],
    });
    expect(msg).toContain('📋 Reminders:');
    expect(msg).toContain("• Mason's permission slip due today");
    expect(msg).toContain('• Electric bill due tomorrow');
  });

  test('omits the Reminders block entirely when no tasks or bills due', () => {
    const msg = buildDailyReminderMessage(SARAH, {});
    expect(msg).not.toContain('Reminders');
  });
});
