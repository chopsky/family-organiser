/**
 * The evening brief - the same brief, about TOMORROW, sent at 20:00.
 *
 * Asked for by a user who kept reading the 07:00 brief after they'd already
 * left for work, by which point it was a report rather than a heads-up.
 *
 * The whole feature is one idea - point the existing builder at a different
 * day - so the tests that matter are the ones that prove (a) the morning brief
 * is untouched, and (b) the evening one actually says tomorrow everywhere a
 * reader would otherwise assume today.
 */
// Mock DB dependencies so the Supabase client isn't initialised during unit tests
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() } }));

const {
  buildDailyReminderMessage,
  buildDailyReminderParts,
  buildDailyReminderTemplateVars,
} = require('./reminders');

const USER = { name: 'Jade Tayla', whatsapp_phone: '+447700900000' };

// A Wednesday, so "tomorrow" is an unambiguous Thursday.
const WED = '2026-07-29';
const THU = '2026-07-30';

const EVENING = { variant: 'evening', anchorDate: THU };

const OPTS = {
  todayEvents: [
    { title: 'Swimming', start_time: `${THU}T16:00:00Z`, all_day: false },
  ],
  dinner: { meal_name: 'Fish pie', cook_time_mins: 40 },
  taskReminders: [{ title: 'Sign the trip form', when: 'today' }],
  shoppingCount: 3,
  tz: 'Europe/London',
};

describe('the morning brief is untouched', () => {
  it('still says today, and never mentions tomorrow', () => {
    const msg = buildDailyReminderMessage(USER, OPTS);

    expect(msg).toContain("Today's Schedule");
    expect(msg).not.toMatch(/Tomorrow/i);
  });

  it('produces identical output whether or not the variant is stated', () => {
    // 'morning' is the default, so passing it explicitly must change nothing.
    // This is what stops the refactor quietly rewording ~every existing user's
    // 07:00 message.
    expect(buildDailyReminderMessage(USER, OPTS))
      .toBe(buildDailyReminderMessage(USER, { ...OPTS, variant: 'morning' }));
  });
});

describe('the evening brief speaks about tomorrow', () => {
  it('opens by naming tomorrow, not the day it is sent', () => {
    const msg = buildDailyReminderMessage(USER, { ...OPTS, ...EVENING });

    expect(msg).toContain("here's tomorrow (Thursday)");
    // "Good morning" at 8pm was the specific thing that made reusing the
    // morning template impossible.
    expect(msg).not.toMatch(/Good morning/i);
  });

  it('labels the schedule and the dinner as tomorrow', () => {
    const msg = buildDailyReminderMessage(USER, { ...OPTS, ...EVENING });

    expect(msg).toContain("Tomorrow's Schedule");
    expect(msg).toContain("Tomorrow's dinner: Fish pie");
  });

  it('says nothing scheduled TOMORROW on an empty day', () => {
    const msg = buildDailyReminderMessage(USER, {
      ...EVENING, tz: 'Europe/London', todayEvents: [], schoolActivities: [],
    });

    expect(msg).toContain('Nothing scheduled tomorrow.');
    expect(msg).not.toContain('Nothing scheduled today.');
  });

  it('takes the weekday from the anchor date, not the clock', () => {
    // The bug this guards: computing the weekday from new Date() would name
    // Wednesday in a message that is entirely about Thursday.
    const parts = buildDailyReminderParts(USER, { ...OPTS, ...EVENING });

    expect(parts.weekday).toBe('Thursday');
    expect(parts.greeting).toBe('Evening');
  });

  it('anchors the morning brief on its own date too', () => {
    const parts = buildDailyReminderParts(USER, { ...OPTS, anchorDate: WED });

    expect(parts.weekday).toBe('Wednesday');
  });
});

describe('template variables follow the same day', () => {
  it('empty-state strings say tomorrow', () => {
    const vars = buildDailyReminderTemplateVars(USER, {
      ...EVENING, tz: 'Europe/London', todayEvents: [], taskReminders: [], billReminders: [],
    });

    expect(vars['2']).toBe('Thursday');
    expect(vars['4']).toBe('Nothing scheduled tomorrow');
    expect(vars['5']).toBe('Nothing due tomorrow');
  });

  it("calls the meal tomorrow's dinner rather than tonight's", () => {
    const vars = buildDailyReminderTemplateVars(USER, { ...OPTS, ...EVENING });

    expect(vars['7']).toBe("Tomorrow's dinner: Fish pie - 40 min");
  });

  it('leaves the morning wording exactly as it was', () => {
    const vars = buildDailyReminderTemplateVars(USER, { ...OPTS, tz: 'Europe/London' });

    expect(vars['7']).toBe("Tonight's dinner: Fish pie - 40 min");
  });
});
