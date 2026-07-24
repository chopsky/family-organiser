const { parseRemindersFromMessage, messageMentionsReminder, snapToTaskNotification } = require('./reminder-parser');

describe('parseRemindersFromMessage', () => {
  describe('the production failure that prompted this code', () => {
    it('parses "remind me 10 minutes before" from a longer event message', () => {
      // Real WhatsApp message that the classifier kept dropping the
      // reminder from. The regex must catch this exact phrasing.
      const text = 'Bookings open for Foxhills padel at 8AM on Sat morning. Please remind me 10 minutes before. Their email is pavilion@foxhills.co.uk';
      expect(parseRemindersFromMessage(text)).toEqual([{ time: 10, unit: 'minutes' }]);
    });
  });

  describe('explicit "remind me N <unit> before" forms', () => {
    it.each([
      ['remind me 30 mins before', 30, 'minutes'],
      ['remind me 30 minutes before', 30, 'minutes'],
      ['remind me 1 hour before', 1, 'hours'],
      ['remind me 2 hours before', 2, 'hours'],
      ['remind me 1 day before', 1, 'days'],
      ['nudge me 15 minutes before', 15, 'minutes'],
      ['ping me 5 mins before', 5, 'minutes'],
      ['notify me 1 day before', 1, 'days'],
      ['alert me 30 mins before', 30, 'minutes'],
    ])('%s -> {time: %d, unit: %s}', (text, time, unit) => {
      expect(parseRemindersFromMessage(text)).toEqual([{ time, unit }]);
    });
  });

  describe('"N <unit> reminder/alert" form (no leading verb)', () => {
    it.each([
      ['add a 10 minute reminder', 10, 'minutes'],
      ['with a 30 min reminder', 30, 'minutes'],
      ['with a 1 hour alert', 1, 'hours'],
      ['with a 15 min notification', 15, 'minutes'],
    ])('%s -> {time: %d, unit: %s}', (text, time, unit) => {
      expect(parseRemindersFromMessage(text)).toEqual([{ time, unit }]);
    });
  });

  describe('bare "N <unit> before" form', () => {
    it.each([
      ['10 minutes before', 10, 'minutes'],
      ['30 mins before', 30, 'minutes'],
      ['1 hour before', 1, 'hours'],
      ['2 days before', 2, 'days'],
      // Spelled-out numbers
      ['five minutes before', 5, 'minutes'],
      ['ten mins before', 10, 'minutes'],
      ['fifteen minutes before', 15, 'minutes'],
      // Articles standing in for "1"
      ['an hour before', 1, 'hours'],
      ['a day before', 1, 'days'],
    ])('%s -> {time: %d, unit: %s}', (text, time, unit) => {
      expect(parseRemindersFromMessage(text)).toEqual([{ time, unit }]);
    });
  });

  describe('multiple reminders in one message', () => {
    it('collects 1 day and 30 minutes', () => {
      const text = 'remind me 1 day before and 30 minutes before';
      expect(parseRemindersFromMessage(text)).toEqual([
        { time: 1, unit: 'days' },
        { time: 30, unit: 'minutes' },
      ]);
    });

    it('deduplicates identical reminders mentioned twice', () => {
      const text = 'remind me 10 minutes before. also 10 mins before.';
      expect(parseRemindersFromMessage(text)).toEqual([{ time: 10, unit: 'minutes' }]);
    });
  });

  describe('no reminder phrasing -> empty array', () => {
    it.each([
      'add dentist on Monday at 3pm',
      'we need milk',
      'remind me to call the vet next week', // "remind me" without "before"
      'set a reminder', // bare reminder noun, no offset
      '',
      'remind me',
    ])('%s -> []', (text) => {
      expect(parseRemindersFromMessage(text)).toEqual([]);
    });
  });

  describe('input validation', () => {
    it('returns [] for non-strings', () => {
      expect(parseRemindersFromMessage(null)).toEqual([]);
      expect(parseRemindersFromMessage(undefined)).toEqual([]);
      expect(parseRemindersFromMessage(123)).toEqual([]);
      expect(parseRemindersFromMessage({})).toEqual([]);
    });

    it('returns [] for whitespace-only strings', () => {
      expect(parseRemindersFromMessage('   ')).toEqual([]);
      expect(parseRemindersFromMessage('\n\t')).toEqual([]);
    });

    it('is case-insensitive', () => {
      expect(parseRemindersFromMessage('REMIND ME 10 MINUTES BEFORE')).toEqual([{ time: 10, unit: 'minutes' }]);
      expect(parseRemindersFromMessage('A 30 Min Reminder')).toEqual([{ time: 30, unit: 'minutes' }]);
    });
  });
});

describe('snapToTaskNotification', () => {
  describe('exact enum matches return snapped: false', () => {
    it.each([
      [{ time: 5, unit: 'minutes' }, '5_min', '5 minutes'],
      [{ time: 15, unit: 'minutes' }, '15_min', '15 minutes'],
      [{ time: 30, unit: 'minutes' }, '30_min', '30 minutes'],
      [{ time: 1, unit: 'hours' }, '1_hour', '1 hour'],
      [{ time: 2, unit: 'hours' }, '2_hours', '2 hours'],
      [{ time: 1, unit: 'days' }, '1_day', '1 day'],
      [{ time: 2, unit: 'days' }, '2_days', '2 days'],
    ])('%p -> %s', (input, expectedValue, expectedLabel) => {
      const result = snapToTaskNotification(input);
      expect(result.value).toBe(expectedValue);
      expect(result.snapped).toBe(false);
      expect(result.chosenLabel).toBe(expectedLabel);
    });
  });

  describe('non-preset offsets snap to nearest enum', () => {
    it('20 minutes snaps to 15_min (closer than 30)', () => {
      const result = snapToTaskNotification({ time: 20, unit: 'minutes' });
      expect(result.value).toBe('15_min');
      expect(result.snapped).toBe(true);
      expect(result.requestedLabel).toBe('20 minutes');
      expect(result.chosenLabel).toBe('15 minutes');
    });

    it('10 minutes snaps to 15_min (closer than 5)', () => {
      // 10-5=5, 15-10=5, tie -> longer lead time wins -> 15_min.
      const result = snapToTaskNotification({ time: 10, unit: 'minutes' });
      expect(result.value).toBe('15_min');
      expect(result.snapped).toBe(true);
    });

    it('45 minutes snaps to 1_hour (tie -> longer lead time)', () => {
      const result = snapToTaskNotification({ time: 45, unit: 'minutes' });
      expect(result.value).toBe('1_hour');
      expect(result.snapped).toBe(true);
    });

    it('90 minutes snaps to 2_hours (tie -> longer)', () => {
      const result = snapToTaskNotification({ time: 90, unit: 'minutes' });
      expect(result.value).toBe('2_hours');
      expect(result.snapped).toBe(true);
    });

    it('25 minutes snaps to 30_min (closer than 15)', () => {
      const result = snapToTaskNotification({ time: 25, unit: 'minutes' });
      expect(result.value).toBe('30_min');
      expect(result.snapped).toBe(true);
    });

    it('3 hours snaps to 2_hours (closer than 1 day)', () => {
      const result = snapToTaskNotification({ time: 3, unit: 'hours' });
      expect(result.value).toBe('2_hours');
      expect(result.snapped).toBe(true);
    });

    it('0 minutes snaps to at_time', () => {
      const result = snapToTaskNotification({ time: 0, unit: 'minutes' });
      expect(result.value).toBe('at_time');
      expect(result.snapped).toBe(false);
    });

    it('1 week snaps to 2_days (closest legal enum)', () => {
      const result = snapToTaskNotification({ time: 1, unit: 'weeks' });
      expect(result.value).toBe('2_days');
      expect(result.snapped).toBe(true);
    });
  });

  describe('invalid input returns null', () => {
    it.each([
      [null],
      [undefined],
      [{ time: 'abc', unit: 'minutes' }],
      [{ time: -5, unit: 'minutes' }],
      [{ time: 5, unit: 'fortnights' }],
      ['not an object'],
    ])('%p -> null', (input) => {
      expect(snapToTaskNotification(input)).toBeNull();
    });
  });
});

describe('messageMentionsReminder', () => {
  it('is true when reminder verbs appear', () => {
    expect(messageMentionsReminder('remind me 10 minutes before')).toBe(true);
    expect(messageMentionsReminder('nudge me tomorrow')).toBe(true);
    expect(messageMentionsReminder('with a 30 min alert')).toBe(true);
    expect(messageMentionsReminder('notify me when it starts')).toBe(true);
  });

  it('is true for bare "N unit before" even without verb', () => {
    // The classifier sometimes treats "10 min before" as a calendar
    // shift; we need to catch it as reminder intent in the guard so
    // the regex pass runs.
    expect(messageMentionsReminder('add dentist Monday 3pm, 10 minutes before')).toBe(true);
  });

  it('is false when no reminder language appears', () => {
    expect(messageMentionsReminder('add dentist on Monday at 3pm')).toBe(false);
    expect(messageMentionsReminder('we need milk')).toBe(false);
    expect(messageMentionsReminder('')).toBe(false);
    expect(messageMentionsReminder(null)).toBe(false);
  });
});

describe('number-less phrasings (the "Day before" loop, 2026-07-24)', () => {
  // The bot's own follow-up question suggests "the day before" as an
  // example; a user typing exactly that (or the bare "day before") got
  // NOTHING parsed and the same question re-asked four times.
  it.each([
    ['the day before', 1, 'days'],
    ['day before', 1, 'days'],
    ['Day before', 1, 'days'],
    ['The day before !!', 1, 'days'],
    ['You said day before', 1, 'days'],
    ['the night before', 1, 'days'],
    ['evening before', 1, 'days'],
    ['the hour before', 1, 'hours'],
    ['half an hour before', 30, 'minutes'],
  ])('%s -> {time: %d, unit: %s}', (text, time, unit) => {
    expect(parseRemindersFromMessage(text)).toEqual([{ time, unit }]);
  });

  it('"half an hour before" does NOT also match "an hour before" (single offset)', () => {
    expect(parseRemindersFromMessage('remind me half an hour before')).toEqual([{ time: 30, unit: 'minutes' }]);
  });

  it('"1 day before" still parses once, not twice, alongside the special phrase', () => {
    expect(parseRemindersFromMessage('1 day before')).toEqual([{ time: 1, unit: 'days' }]);
  });
});

describe('parseBareDuration (pending-reply-only whole-message durations)', () => {
  const { parseBareDuration } = require('./reminder-parser');
  it.each([
    ['2 hours', 2, 'hours'],
    ['30 mins', 30, 'minutes'],
    ['1 hr', 1, 'hours'],
    ['a day', 1, 'days'],
    ['half an hour', 30, 'minutes'],
    ['in 20 minutes', 20, 'minutes'],
    ['2 hours before.', 2, 'hours'],
  ])('%s -> {time: %d, unit: %s}', (text, time, unit) => {
    expect(parseBareDuration(text)).toEqual([{ time, unit }]);
  });

  it('refuses durations embedded in longer messages (no false positives)', () => {
    expect(parseBareDuration('book the court for 2 hours')).toEqual([]);
    expect(parseBareDuration('the meeting runs 30 mins late')).toEqual([]);
    expect(parseBareDuration('yes')).toEqual([]);
  });
});

describe('describeOffsets (confirmation copy)', () => {
  const { describeOffsets } = require('./reminder-parser');
  it('phrases common offsets naturally', () => {
    expect(describeOffsets([{ time: 1, unit: 'days' }])).toBe('the day before');
    expect(describeOffsets([{ time: 1, unit: 'hours' }])).toBe('an hour before');
    expect(describeOffsets([{ time: 2, unit: 'hours' }])).toBe('2 hours before');
    expect(describeOffsets([{ time: 30, unit: 'minutes' }])).toBe('30 minutes before');
    expect(describeOffsets([{ time: 1, unit: 'days' }, { time: 30, unit: 'minutes' }])).toBe('the day before and 30 minutes before');
  });
});
