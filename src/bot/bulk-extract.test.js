const { looksLikeBulkPaste, looksLikeSchoolTermDates } = require('./bulk-extract');

describe('looksLikeSchoolTermDates', () => {
  test('fires on the explicit "term dates" phrase', () => {
    expect(looksLikeSchoolTermDates('Wolfson Hillel — term dates 2026/27')).toBe(true);
  });

  test('fires on a multi-marker term calendar (named term + half-term + INSET)', () => {
    const doc = `Autumn term: 4 Sep – 20 Dec
Half term: 21–25 Oct
INSET day: 2 Sep
Spring term: 6 Jan – 28 Mar`;
    expect(looksLikeSchoolTermDates(doc)).toBe(true);
  });

  test('does NOT fire on a single passing marker (one INSET line in a fixture list)', () => {
    const fixtures = `U11 Cricket fixtures
01/06 v The Hall
08/06 v Highgate
(INSET day 15/06 — no match)`;
    expect(looksLikeSchoolTermDates(fixtures)).toBe(false);
  });

  test('does NOT fire on ordinary text or empty/non-string input', () => {
    expect(looksLikeSchoolTermDates('Can you add milk and eggs to the list?')).toBe(false);
    expect(looksLikeSchoolTermDates('')).toBe(false);
    expect(looksLikeSchoolTermDates(null)).toBe(false);
  });
});

describe('looksLikeBulkPaste', () => {
  // The actual U11 cricket team sheet that the bot failed to extract
  // from in the 2026-06-01 churn transcript.
  const cricketSheet = `U11 Cricket 2026

Date: 01/06/2026

Fixture Information

Rahul C
Medansh B

V The Hall

C - Capt`;

  test('catches the cricket fixture sheet that caused the churn', () => {
    expect(looksLikeBulkPaste(cricketSheet)).toBe(true);
  });

  test('catches a multi-line schedule with dates', () => {
    const t = `Term dates Autumn 2026\nINSET day: 02/09\nTerm starts: 03/09\nHalf term: 27/10 - 31/10\nTerm ends: 19/12`;
    expect(looksLikeBulkPaste(t)).toBe(true);
  });

  test('catches a long block with a schedule keyword', () => {
    const t = 'Swimming gala fixtures for the whole season are now confirmed and the full squad list is attached below for all of the age groups who are competing this term across the entire county league programme, so please do check carefully.';
    expect(t.length).toBeGreaterThanOrEqual(180); // guard: this test exercises the length+keyword path
    expect(looksLikeBulkPaste(t)).toBe(true);
  });

  test('ignores a short chat message', () => {
    expect(looksLikeBulkPaste('add milk to the list')).toBe(false);
    expect(looksLikeBulkPaste('what time is the dentist')).toBe(false);
    expect(looksLikeBulkPaste('ugh')).toBe(false);
  });

  test('ignores a long conversational message with no schedule signal', () => {
    const t = 'I just wanted to say thank you so much for all the help this week, it has genuinely made our mornings so much calmer and the whole family is really enjoying using this together every single day now.';
    expect(looksLikeBulkPaste(t)).toBe(false);
  });

  test('ignores a single short dated sentence (handled by normal classifier)', () => {
    expect(looksLikeBulkPaste('dentist on 01/06 at 3pm')).toBe(false);
  });

  test('handles non-string input', () => {
    expect(looksLikeBulkPaste(null)).toBe(false);
    expect(looksLikeBulkPaste(undefined)).toBe(false);
    expect(looksLikeBulkPaste(42)).toBe(false);
  });
});
