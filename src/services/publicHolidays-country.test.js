/**
 * Country handling in the holiday seeder: OTHER must never fall back to
 * timezone (the Maxine mis-country - Europe/Madrid seeded 64 Spanish
 * bank holidays for a UK household, 2026-08-10), and the replace
 * re-seed must wipe before inserting.
 */
jest.mock('axios');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../db/queries');

const axios = require('axios');
const db = require('../db/queries');
const {
  resolveCountryCode, seedHolidaysForNewHousehold, replaceHolidaysForHousehold,
} = require('./publicHolidays');

const NAGER_DAY = [{ date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day' }];

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: NAGER_DAY });
  db.deletePublicHolidayEvents.mockResolvedValue({ removed: 64 });
  db.createCalendarEvent = db.createCalendarEvent || jest.fn();
});

describe('resolveCountryCode', () => {
  test('OTHER never falls back to timezone', () => {
    expect(resolveCountryCode({ country: 'OTHER', timezone: 'Europe/Madrid' })).toBeNull();
  });

  test('known country wins', () => {
    expect(resolveCountryCode({ country: 'GB', timezone: 'Europe/Madrid' })).toBe('GB');
  });

  test('legacy null country still derives from timezone', () => {
    expect(resolveCountryCode({ country: null, timezone: 'Europe/London' })).toBe('GB');
  });
});

describe('seedHolidaysForNewHousehold', () => {
  test('country OTHER seeds nothing, even with a mappable timezone', async () => {
    await seedHolidaysForNewHousehold('hh-1', 'Europe/Madrid', 'u1', 'OTHER');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('known country seeds current + next year', async () => {
    await seedHolidaysForNewHousehold('hh-1', 'Europe/Madrid', 'u1', 'GB');
    // Two Nager fetches (this year + next), both for GB regardless of tz.
    expect(axios.get).toHaveBeenCalledTimes(2);
    for (const call of axios.get.mock.calls) {
      expect(call[0]).toContain('/GB');
    }
  });
});

describe('replaceHolidaysForHousehold', () => {
  test('wipes the old set then seeds the new country', async () => {
    const result = await replaceHolidaysForHousehold('hh-1', 'GB', 'u1');
    expect(db.deletePublicHolidayEvents).toHaveBeenCalledWith('hh-1');
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(result.removed).toBe(64);
  });

  test('OTHER wipes and seeds nothing', async () => {
    const result = await replaceHolidaysForHousehold('hh-1', 'OTHER', 'u1');
    expect(db.deletePublicHolidayEvents).toHaveBeenCalledWith('hh-1');
    expect(axios.get).not.toHaveBeenCalled();
    expect(result.inserted).toBe(0);
  });
});
