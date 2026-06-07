jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { isBirthdayTitle } = require('./queries');

describe('isBirthdayTitle', () => {
  test.each([
    "Mia's birthday party",
    "Grandma's Birthday",
    'Olivia 7th birthday',
    'Dad bday drinks',
    'b-day lunch',
    "Henry's Birthday 🎂",
  ])('matches "%s"', (t) => {
    expect(isBirthdayTitle(t)).toBe(true);
  });

  test.each([
    'Dentist appointment',
    'Football training',
    'Birthing class', // must not match on a substring
    'Abday', // not a word-boundary bday
    '',
    null,
    undefined,
  ])('does not match "%s"', (t) => {
    expect(isBirthdayTitle(t)).toBe(false);
  });
});
