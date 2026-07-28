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
  it('opens warmly, and says tomorrow without bracketing the weekday', () => {
    const msg = buildDailyReminderMessage(USER, { ...OPTS, ...EVENING });

    expect(msg).toContain("Evening, Jade Tayla! Here's how tomorrow's looking:");
    // "tomorrow (Thursday)" read like a database field, so the weekday moved
    // down into the schedule heading instead.
    expect(msg).not.toContain('(Thursday)');
    // "Good morning" at 8pm was the specific thing that made reusing the
    // morning template impossible.
    expect(msg).not.toMatch(/Good morning/i);
  });

  it('names the weekday in the schedule heading', () => {
    const msg = buildDailyReminderMessage(USER, { ...OPTS, ...EVENING });

    expect(msg).toContain("📅 Thursday's Schedule:");
  });

  it('leaves out the dinner and the shopping list', () => {
    // A night-before heads-up is about what's HAPPENING. Domestic admin makes
    // it longer without making it more useful at 8pm, and both still appear in
    // the morning brief.
    const msg = buildDailyReminderMessage(USER, { ...OPTS, ...EVENING });

    expect(msg).not.toMatch(/Fish pie/);
    expect(msg).not.toMatch(/shopping list/i);
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

    // Weather is {{2}} and weekday {{3}} in the evening template - the
    // reverse of the morning one. WhatsApp needs variables to appear in
    // ascending order in the body, and the evening layout puts weather first.
    // Numbering by meaning rather than position got v1 rejected.
    expect(vars['3']).toBe('Thursday');
    expect(vars['4']).toBe('Nothing scheduled tomorrow');
    expect(vars['5']).toBe('Nothing due tomorrow');
  });

  it('is SIX variables in the evening - no shopping, no dinner', () => {
    // Twilio rejects empty variable values (21656), so a dropped section means
    // renumbering the template rather than sending an empty string.
    const vars = buildDailyReminderTemplateVars(USER, { ...OPTS, ...EVENING });

    expect(Object.keys(vars)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(vars['6']).not.toMatch(/Fish pie/);
    expect(JSON.stringify(vars)).not.toMatch(/shopping list/i);
  });

  it('is still SEVEN in the morning, shopping and dinner intact', () => {
    const vars = buildDailyReminderTemplateVars(USER, { ...OPTS, tz: 'Europe/London' });

    expect(Object.keys(vars)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(vars['6']).toBe('3 items on the shopping list');
  });

  it('leaves the morning wording exactly as it was', () => {
    const vars = buildDailyReminderTemplateVars(USER, { ...OPTS, tz: 'Europe/London' });

    expect(vars['7']).toBe("Tonight's dinner: Fish pie - 40 min");
  });
});

describe('reminder day labels', () => {
  // The evening brief's anchor day IS tomorrow, so comparing a due date
  // against the anchor produced the word "today" - telling someone at 8pm that
  // a form was due the day that had just ended. Caught by rendering the
  // message and reading it, which is the only way this kind of thing shows up.
  const { buildDailyReminderTemplateVars: vars } = require('./reminders');

  it('calls anchor-day items tomorrow, and the day after by name', () => {
    const out = vars(USER, {
      ...EVENING,
      tz: 'Europe/London',
      taskReminders: [
        { title: 'Sign the trip form', when: 'tomorrow' },
        { title: 'Council tax', when: 'Friday' },
      ],
    });

    expect(out['5']).toBe('Sign the trip form due tomorrow · Council tax due Friday');
    expect(out['5']).not.toMatch(/due today/);
  });
});

describe('template variable ORDER matches the body', () => {
  // housemait_evening_brief_v1 was rejected by WhatsApp. Comparing it against
  // the approved morning template showed three defects in the spec, all of
  // which this suite now pins.
  it('numbers weather before weekday, so the body can run 1,2,3,4,5,6', () => {
    const vars = buildDailyReminderTemplateVars(USER, {
      ...OPTS, ...EVENING, weatherLine: '🌦 19°C, wet day in London',
    });

    expect(vars['2']).toBe('🌦 19°C, wet day in London');
    expect(vars['3']).toBe('Thursday');
  });

  it('leaves the approved morning numbering alone', () => {
    const vars = buildDailyReminderTemplateVars(USER, {
      ...OPTS, tz: 'Europe/London', anchorDate: THU, weatherLine: '🌦 19°C, wet day in London',
    });

    expect(vars['2']).toBe('Thursday');
    expect(vars['3']).toBe('🌦 19°C, wet day in London');
  });
});
