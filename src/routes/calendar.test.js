/**
 * Tests for the calendar route's pure helpers. calendar.js requires the DB
 * client + push/broadcast/feed services at import time (all needing real
 * env), so we mock that chain to a no-op surface and pull the exported
 * timeRangeError helper off the router.
 */
jest.mock('../db/queries', () => ({}));
jest.mock('../middleware/auth', () => ({ requireAuth: (req, res, next) => next() }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), invalidatePattern: jest.fn() }));
jest.mock('../services/push', () => ({}));
jest.mock('../services/broadcast', () => ({}));
jest.mock('../services/externalFeed', () => ({}));
jest.mock('../services/publicHolidays', () => ({}));
jest.mock('../services/r2', () => ({}));

const { timeRangeError } = require('./calendar');

describe('timeRangeError', () => {
  it('rejects an end that falls before the start on the same day', () => {
    // The reported bug: start 15:00, end 10:00.
    expect(timeRangeError('2026-06-10T15:00:00', '2026-06-10T10:00:00')).toMatch(/before its start/i);
  });

  it('rejects an end on an earlier day than the start', () => {
    expect(timeRangeError('2026-06-10T09:00:00Z', '2026-06-09T09:00:00Z')).toMatch(/before its start/i);
  });

  it('accepts a normal forward range', () => {
    expect(timeRangeError('2026-06-10T09:00:00', '2026-06-10T10:00:00')).toBeNull();
  });

  it('accepts an all-day event (midnight → end of day)', () => {
    expect(timeRangeError('2026-06-10T00:00:00', '2026-06-10T23:59:59')).toBeNull();
  });

  it('accepts equal start and end (zero-length / all-day-as-midnight)', () => {
    // Strict `<` means equal timestamps are allowed - some sources store
    // all-day events as start == end at midnight.
    expect(timeRangeError('2026-06-10T00:00:00', '2026-06-10T00:00:00')).toBeNull();
  });

  it('accepts a multi-day range', () => {
    expect(timeRangeError('2026-06-10T09:00:00', '2026-06-12T17:00:00')).toBeNull();
  });

  it('does not block when a timestamp is missing (left to required-field checks)', () => {
    expect(timeRangeError(null, '2026-06-10T10:00:00')).toBeNull();
    expect(timeRangeError('2026-06-10T10:00:00', undefined)).toBeNull();
    expect(timeRangeError('', '')).toBeNull();
  });

  it('does not block when a timestamp is unparseable', () => {
    expect(timeRangeError('not-a-date', '2026-06-10T10:00:00')).toBeNull();
    expect(timeRangeError('2026-06-10T10:00:00', 'garbage')).toBeNull();
  });
});
