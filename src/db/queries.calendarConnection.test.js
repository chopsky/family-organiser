/**
 * Unit tests for computeCalendarConnectionStats - the activation-keystone
 * metric (does a household have a live calendar, and did it connect within
 * 7 days of signup?). Pure function; stub ./client so queries.js imports.
 */
jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {} }));

const { computeCalendarConnectionStats } = require('./queries');

const NOW = '2026-06-12T12:00:00.000Z';
const daysBefore = (d) => new Date(new Date(NOW).getTime() - d * 86400000).toISOString();

describe('computeCalendarConnectionStats', () => {
  test('counts connected households and splits device vs URL', () => {
    const households = [
      { id: 'h1', created_at: daysBefore(30) },
      { id: 'h2', created_at: daysBefore(30) },
      { id: 'h3', created_at: daysBefore(30) }, // no feed
    ];
    const feeds = [
      { household_id: 'h1', source: 'device', sync_enabled: true, created_at: daysBefore(29) },
      { household_id: 'h2', source: 'ical', sync_enabled: true, created_at: daysBefore(10) },
    ];
    const s = computeCalendarConnectionStats({ households, feeds, now: NOW });
    expect(s.total).toBe(3);
    expect(s.connected).toBe(2);
    expect(s.connectedPct).toBe(66.7);
    expect(s.deviceConnected).toBe(1);
    expect(s.urlConnected).toBe(1);
  });

  test('tombstoned (sync_enabled=false) feeds do not count as connected', () => {
    const households = [{ id: 'h1', created_at: daysBefore(30) }];
    const feeds = [{ household_id: 'h1', source: 'device', sync_enabled: false, created_at: daysBefore(20) }];
    const s = computeCalendarConnectionStats({ households, feeds, now: NOW });
    expect(s.connected).toBe(0);
    expect(s.connectedPct).toBe(0);
  });

  test('7-day activation: only counts households old enough, and within-window connections', () => {
    const households = [
      { id: 'fast', created_at: daysBefore(30) },   // connected day 2 → activated
      { id: 'slow', created_at: daysBefore(30) },    // connected day 20 → eligible, not activated
      { id: 'never', created_at: daysBefore(30) },   // never connected → eligible, not activated
      { id: 'young', created_at: daysBefore(3) },    // too new → not eligible
    ];
    const feeds = [
      { household_id: 'fast', source: 'device', sync_enabled: true, created_at: daysBefore(28) },
      { household_id: 'slow', source: 'ical', sync_enabled: true, created_at: daysBefore(10) },
      { household_id: 'young', source: 'device', sync_enabled: true, created_at: daysBefore(2) },
    ];
    const s = computeCalendarConnectionStats({ households, feeds, now: NOW });
    expect(s.eligible7d).toBe(3); // fast, slow, never (young excluded)
    expect(s.activated7d).toBe(1); // only fast
    expect(s.activation7dPct).toBe(33.3);
  });

  test('feeds for unknown/internal households are ignored', () => {
    const households = [{ id: 'h1', created_at: daysBefore(30) }];
    const feeds = [{ household_id: 'internal-x', source: 'device', sync_enabled: true, created_at: daysBefore(5) }];
    const s = computeCalendarConnectionStats({ households, feeds, now: NOW });
    expect(s.total).toBe(1);
    expect(s.connected).toBe(0);
  });

  test('empty inputs yield null percentages, not NaN', () => {
    const s = computeCalendarConnectionStats({ households: [], feeds: [], now: NOW });
    expect(s.total).toBe(0);
    expect(s.connectedPct).toBeNull();
    expect(s.activation7dPct).toBeNull();
  });
});
