jest.mock('./client', () => ({ supabase: {}, supabaseAdmin: {} }));
const { isBirthdayTitle } = require('./queries');

describe('isBirthdayTitle - real birthdays', () => {
  test.each([
    "John's Birthday",
    "Mia's 7th birthday",
    "Grandma's bday",
    'Happy Birthday Mum',
    "Dad's birthday 🎂",
    'Birthday',
    // No-apostrophe / plural-possessive forms
    'Felicity birthday',
    'Ruby bday',
    "Rael Philips' Birthday",
    'Mel G, Martin, Kiki Birthday',
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
    // A party/celebration is a separate event, not the birthday itself
    "Olivia's birthday party",
    "Tom's birthday dinner",
    'Office birthday celebration for Tom',
    'Birthday drinks',
    "Sarah's birthday tea",
    'Birthday date night',
    'Play date for Leo bday',
    'Drop mom at Val bday',
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
