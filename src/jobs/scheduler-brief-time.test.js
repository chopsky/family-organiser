/**
 * resolveBriefTime - the household-configurable morning-brief time.
 * The gate must honour a valid households.reminder_time and fall back to
 * the 07:00 default on anything malformed (a bad value must never
 * silently kill a household's brief).
 */

jest.mock('../db/queries');
jest.mock('./reminders', () => ({ sendDailyReminders: jest.fn(), sendEveningBriefs: jest.fn() }));
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() }, supabaseAdmin: { from: jest.fn() } }));

const { resolveBriefTime } = require('./scheduler');

describe('resolveBriefTime', () => {
  test('honours a valid HH:MM household time', () => {
    expect(resolveBriefTime('06:00')).toBe('06:00');
    expect(resolveBriefTime('05:30')).toBe('05:30');
    expect(resolveBriefTime('10:00')).toBe('10:00');
  });

  test('falls back to 07:00 for null/empty/malformed values', () => {
    expect(resolveBriefTime(null)).toBe('07:00');
    expect(resolveBriefTime(undefined)).toBe('07:00');
    expect(resolveBriefTime('')).toBe('07:00');
    expect(resolveBriefTime('6am')).toBe('07:00');
    expect(resolveBriefTime('25:00')).toBe('07:00');
    expect(resolveBriefTime('07:60')).toBe('07:00');
    expect(resolveBriefTime('7:00')).toBe('07:00'); // must be zero-padded
  });
});
