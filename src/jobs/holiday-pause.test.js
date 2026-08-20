/**
 * Holiday-pause push copy: the one-line body must read naturally for one
 * activity, a handful, and multiple children - and never fire empty.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');
jest.mock('../services/push');

const { buildHolidayPauseBody } = require('./holiday-pause');

describe('buildHolidayPauseBody', () => {
  test('one child, one activity', () => {
    expect(buildHolidayPauseBody({ Mason: ['Gym with Gavin'] })).toBe(
      "Term's ended: Mason's Gym with Gavin is paused. Keep any running through the holidays?",
    );
  });

  test('one child, two activities', () => {
    expect(buildHolidayPauseBody({ Mason: ['Tennis', 'Gym'] })).toBe(
      "Term's ended: Mason's Tennis and Gym are paused. Keep any running through the holidays?",
    );
  });

  test('one child, many activities names two and counts the rest', () => {
    const body = buildHolidayPauseBody({
      Mason: ['Tennis', 'Gym', 'Art', 'Piano', 'Cooking', 'Swimming', 'Club Hillel'],
    });
    expect(body).toBe(
      "Term's ended: Mason's Tennis, Gym and 5 more are paused. Keep any running through the holidays?",
    );
  });

  test('two children counts the lot', () => {
    const body = buildHolidayPauseBody({
      Mason: ['Tennis', 'Gym', 'Art', 'Piano', 'Cooking', 'Swimming', 'Club Hillel'],
      Logan: ['Swimming', 'Wraparound Care', 'Wraparound Care', 'Wraparound Care'],
    });
    expect(body).toBe(
      "Term's ended: Mason and Logan's clubs (11) are paused. Keep any running through the holidays?",
    );
  });

  test('no children -> null (nothing to say)', () => {
    expect(buildHolidayPauseBody({})).toBeNull();
  });
});
