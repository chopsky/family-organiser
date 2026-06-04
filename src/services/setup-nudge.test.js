const { detectSetupGaps, buildWhatsAppNudge, buildPushNudge } = require('./setup-nudge');

describe('detectSetupGaps', () => {
  test('fully set up household has no gaps', () => {
    expect(detectSetupGaps({
      hasCalendarFeeds: true, hasSchools: true, hasAddress: true, hasChildren: true,
    })).toEqual([]);
  });

  test('flags missing calendars, schools and address in priority order', () => {
    expect(detectSetupGaps({
      hasCalendarFeeds: false, hasSchools: false, hasAddress: false, hasChildren: true,
    })).toEqual(['calendars', 'schools', 'address']);
  });

  test('does NOT nudge about schools when the household has no children', () => {
    const gaps = detectSetupGaps({
      hasCalendarFeeds: false, hasSchools: false, hasAddress: true, hasChildren: false,
    });
    expect(gaps).toEqual(['calendars']);
    expect(gaps).not.toContain('schools');
  });

  test('only the address gap when calendars + schools are done', () => {
    expect(detectSetupGaps({
      hasCalendarFeeds: true, hasSchools: true, hasAddress: false, hasChildren: true,
    })).toEqual(['address']);
  });
});

describe('buildWhatsAppNudge', () => {
  test('uses first name, lists gaps, names a screen, and is dash-free', () => {
    const msg = buildWhatsAppNudge('Grant Shapiro', ['calendars', 'schools']);
    expect(msg).toMatch(/^Hi Grant!/);
    expect(msg).toMatch(/shared calendars/);
    expect(msg).toMatch(/school term dates/);
    expect(msg).toMatch(/Connect Calendars/); // the screen for the first gap
    expect(msg).not.toMatch(/[—–]/); // no em or en dashes
  });

  test('returns null when there are no valid gaps', () => {
    expect(buildWhatsAppNudge('Grant', [])).toBeNull();
    expect(buildWhatsAppNudge('Grant', ['bogus'])).toBeNull();
  });
});

describe('buildPushNudge', () => {
  test('returns a short title + body naming the gaps', () => {
    const n = buildPushNudge(['address']);
    expect(n.title).toBe('Finish setting up Housemait');
    expect(n.body).toMatch(/home address/);
    expect(n.body).not.toMatch(/[—–]/);
  });

  test('returns null with no valid gaps', () => {
    expect(buildPushNudge([])).toBeNull();
  });
});
