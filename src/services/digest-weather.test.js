/**
 * pickMemberLocation drives the morning-brief location precedence: a member's
 * shared device location is only "fresh" (and thus allowed to outrank the typed
 * home address) if updated within 48h. Pure logic - no network.
 */
const { pickMemberLocation } = require('./digest-weather');

const NOW = Date.parse('2026-07-22T09:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test('no member has coords → null', () => {
  expect(pickMemberLocation([{ id: 'a' }, { id: 'b', latitude: null }], NOW)).toBeNull();
  expect(pickMemberLocation([], NOW)).toBeNull();
  expect(pickMemberLocation(undefined, NOW)).toBeNull();
});

test('a recently-updated location is fresh', () => {
  const r = pickMemberLocation([{ latitude: 51.5, longitude: -0.12, location_updated_at: hoursAgo(2) }], NOW);
  expect(r).toMatchObject({ lat: 51.5, lon: -0.12, fresh: true });
});

test('a location older than 48h is stale (fresh:false)', () => {
  const r = pickMemberLocation([{ latitude: 51.5, longitude: -0.12, location_updated_at: hoursAgo(72) }], NOW);
  expect(r).toMatchObject({ lat: 51.5, lon: -0.12, fresh: false });
});

test('a coord with no timestamp is treated as stale (still a last-resort location)', () => {
  const r = pickMemberLocation([{ latitude: 40, longitude: -74 }], NOW);
  expect(r).toMatchObject({ lat: 40, lon: -74, fresh: false });
});

test('picks the most recently-updated member when several have coords', () => {
  const r = pickMemberLocation([
    { latitude: 1, longitude: 1, location_updated_at: hoursAgo(30) },
    { latitude: 2, longitude: 2, location_updated_at: hoursAgo(3) },   // freshest
    { latitude: 3, longitude: 3, location_updated_at: hoursAgo(50) },
  ], NOW);
  expect(r).toMatchObject({ lat: 2, lon: 2, fresh: true });
});

test('exactly 48h old still counts as fresh (boundary)', () => {
  const r = pickMemberLocation([{ latitude: 5, longitude: 5, location_updated_at: hoursAgo(48) }], NOW);
  expect(r.fresh).toBe(true);
});
