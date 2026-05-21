const { parseRemindersFromMessage, messageMentionsReminder } = require('./reminder-parser');

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
