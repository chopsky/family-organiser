jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { isBirthdayTitle } = require('./queries');

describe('isBirthdayTitle - real birthdays', () => {
  test.each([
    "John's Birthday",
    "Mia's 7th birthday",
    "Grandma's bday",
    'Happy Birthday Mum',
    "Dad's birthday 🎂",
    "Olivia's birthday party",
    'Birthday',
    'Office birthday celebration for Tom',
  ])('matches "%s"', (t) => {
    expect(isBirthdayTitle(t)).toBe(true);
  });
});

describe('isBirthdayTitle - NOT birthdays (errands / mentions)', () => {
  test.each([
    'Buy birthday gift for John',
    'Wrap birthday present',
    'Birthday card for Sara',
    'Order birthday cake',
    'Plan Mia birthday party shopping',
    'RSVP to birthday party',
    'Birthday gift ideas',
    'Pick up birthday balloons',
    // Plain non-birthday events
    'Dentist appointment',
    'Football training',
    'Birthing class',
    'Abday',
    '',
    null,
    undefined,
  ])('does not match "%s"', (t) => {
    expect(isBirthdayTitle(t)).toBe(false);
  });
});
