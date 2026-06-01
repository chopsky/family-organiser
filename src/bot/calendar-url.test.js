const { detectCalendarFeedUrl, isCalendarFeedUrl, firstUrl, feedDisplayName } = require('./calendar-url');

describe('calendar-url detection', () => {
  describe('isCalendarFeedUrl', () => {
    test('Google Calendar private iCal URL', () => {
      expect(isCalendarFeedUrl('https://calendar.google.com/calendar/ical/family09301695198036627631%40group.calendar.google.com/private-e781370fec7b2b8/basic.ics')).toBe(true);
    });
    test('webcal scheme', () => {
      expect(isCalendarFeedUrl('webcal://p123-caldav.icloud.com/published/2/abcdef')).toBe(true);
    });
    test('any .ics file', () => {
      expect(isCalendarFeedUrl('https://example.com/feeds/term-dates.ics')).toBe(true);
      expect(isCalendarFeedUrl('https://example.com/feeds/term-dates.ics?token=x')).toBe(true);
    });
    test('iCloud published', () => {
      expect(isCalendarFeedUrl('https://p52-caldav.icloud.com/published/2/MT...')).toBe(true);
    });
    test('Outlook (Office 365) published .ics feed', () => {
      expect(isCalendarFeedUrl('https://outlook.office365.com/owa/calendar/abc123/def456/calendar.ics')).toBe(true);
    });
    test('Outlook.com (personal) published .ics feed', () => {
      expect(isCalendarFeedUrl('https://outlook.live.com/owa/calendar/00000000-0000-0000-0000-000000000000/cid-ABCD1234/calendar.ics')).toBe(true);
    });
    test('rejects the Outlook .html VIEW link (not subscribable)', () => {
      // Outlook publishes both an .ics feed and an .html view; only the
      // .ics is subscribable. We must NOT accept the .html or we silently
      // "connect" a feed that never syncs.
      expect(isCalendarFeedUrl('https://outlook.office365.com/owa/calendar/abc123/def456/calendar.html')).toBe(false);
    });
    test('Apple iCloud webcal feed (does not end in .ics)', () => {
      expect(isCalendarFeedUrl('webcal://p52-caldav.icloud.com/published/2/MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkw')).toBe(true);
    });
    test('Apple iCloud published feed in https form', () => {
      expect(isCalendarFeedUrl('https://p52-caldav.icloud.com/published/2/MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkw')).toBe(true);
    });
    test('rejects a normal web link', () => {
      expect(isCalendarFeedUrl('https://www.bbc.co.uk/news')).toBe(false);
    });
    test('rejects a Google Calendar event link (not a feed)', () => {
      expect(isCalendarFeedUrl('https://calendar.google.com/calendar/u/0/r/eventedit')).toBe(false);
    });
    test('null / empty', () => {
      expect(isCalendarFeedUrl(null)).toBe(false);
      expect(isCalendarFeedUrl('')).toBe(false);
    });
  });

  describe('firstUrl', () => {
    test('extracts bare URL', () => {
      expect(firstUrl('https://example.com/x.ics')).toBe('https://example.com/x.ics');
    });
    test('extracts URL embedded in a sentence', () => {
      expect(firstUrl("here's my calendar: https://example.com/x.ics thanks")).toBe('https://example.com/x.ics');
    });
    test('strips trailing punctuation', () => {
      expect(firstUrl('see (https://example.com/x.ics).')).toBe('https://example.com/x.ics');
    });
    test('returns null when no URL', () => {
      expect(firstUrl('no link here')).toBeNull();
    });
  });

  describe('detectCalendarFeedUrl', () => {
    test('detects feed inside a sentence', () => {
      expect(detectCalendarFeedUrl('connect this: webcal://p1.icloud.com/published/2/x')).toBe('webcal://p1.icloud.com/published/2/x');
    });
    test('returns null for non-calendar URL', () => {
      expect(detectCalendarFeedUrl('check https://news.bbc.co.uk')).toBeNull();
    });
    test('returns null for plain text', () => {
      expect(detectCalendarFeedUrl('add milk to the list')).toBeNull();
    });
  });

  describe('feedDisplayName', () => {
    test('maps known hosts', () => {
      expect(feedDisplayName('https://calendar.google.com/calendar/ical/x/basic.ics')).toBe('Google Calendar');
      expect(feedDisplayName('webcal://p1.icloud.com/published/2/x')).toBe('Apple Calendar');
      expect(feedDisplayName('https://outlook.office365.com/owa/calendar/x/calendar.ics')).toBe('Outlook Calendar');
    });
    test('falls back to generic', () => {
      expect(feedDisplayName('https://example.com/x.ics')).toBe('Subscribed calendar');
    });
  });
});
