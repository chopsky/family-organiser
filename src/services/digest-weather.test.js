/**
 * pickMemberLocation drives the morning-brief location precedence: a member's
 * shared device location is only "fresh" (and thus allowed to outrank the typed
 * home address) if updated within 48h. Pure logic - no network.
 */
const { pickMemberLocation, cachedHouseholdGeocode, metnoToWmo, summariseMetnoToday, coordCacheKey } = require('./digest-weather');

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

describe('cachedHouseholdGeocode', () => {
  const cached = {
    address: 'Heton Gardens, London, NW4 4XS',
    geo_address: 'Heton Gardens, London, NW4 4XS',
    geo_latitude: 51.589, geo_longitude: -0.233, geo_city: 'London',
  };

  test('reuses the cached coords when the address is unchanged', () => {
    expect(cachedHouseholdGeocode(cached)).toEqual({ lat: 51.589, lon: -0.233, cityName: 'London' });
  });

  test('ignores the cache when the address has changed (→ re-geocode)', () => {
    expect(cachedHouseholdGeocode({ ...cached, address: '10 New Road, Leeds' })).toBeNull();
  });

  test('null when nothing is cached yet', () => {
    expect(cachedHouseholdGeocode({ address: '10 New Road, Leeds' })).toBeNull();
  });

  test('null when there is no address', () => {
    expect(cachedHouseholdGeocode({ geo_latitude: 1, geo_longitude: 2 })).toBeNull();
    expect(cachedHouseholdGeocode({})).toBeNull();
  });
});

describe('metnoToWmo', () => {
  test('clear/cloud family maps to the right WMO buckets', () => {
    expect(metnoToWmo('clearsky_day')).toBe(0);
    expect(metnoToWmo('clearsky_night')).toBe(0);
    expect(metnoToWmo('fair_day')).toBe(1);
    expect(metnoToWmo('partlycloudy_polartwilight')).toBe(2);
    expect(metnoToWmo('cloudy')).toBe(3);
    expect(metnoToWmo('fog')).toBe(45);
  });

  test('rain intensity buckets', () => {
    expect(metnoToWmo('lightrain')).toBe(61);
    expect(metnoToWmo('lightrainshowers_day')).toBe(61);
    expect(metnoToWmo('rain')).toBe(63);
    expect(metnoToWmo('rainshowers_night')).toBe(63);
    expect(metnoToWmo('heavyrain')).toBe(65);
    expect(metnoToWmo('heavyrainshowers_day')).toBe(65);
  });

  test('thunder wins over rain/snow, sleet and snow map through', () => {
    expect(metnoToWmo('heavyrainandthunder')).toBe(95);
    expect(metnoToWmo('heavysnowshowersandthunder_day')).toBe(95);
    expect(metnoToWmo('sleet')).toBe(66);
    expect(metnoToWmo('lightsleetshowers_night')).toBe(66);
    expect(metnoToWmo('lightsnow')).toBe(71);
    expect(metnoToWmo('heavysnow')).toBe(75);
  });

  test('unknown / empty → undefined (weather-line falls through to generic)', () => {
    expect(metnoToWmo('made_up_symbol')).toBeUndefined();
    expect(metnoToWmo('')).toBeUndefined();
    expect(metnoToWmo(null)).toBeUndefined();
    expect(metnoToWmo(undefined)).toBeUndefined();
  });
});

describe('summariseMetnoToday', () => {
  // 2026-07-23 06:00Z = 07:00 BST (Europe/London, UTC+1). The timeseries
  // spans today + tomorrow; only today's entries must count.
  const NOW = Date.parse('2026-07-23T06:00:00Z');
  const entry = (iso, temp, sym, precip) => ({
    time: iso,
    data: {
      instant: { details: { air_temperature: temp } },
      ...(sym != null || precip != null
        ? { next_1_hours: { summary: sym ? { symbol_code: sym } : undefined, details: precip != null ? { precipitation_amount: precip } : undefined } }
        : {}),
    },
  });

  test('hi/lo across today only; midday symbol; precip from amount', () => {
    const series = [
      entry('2026-07-23T06:00:00Z', 15, 'cloudy', 0),         // 07:00 local
      entry('2026-07-23T11:00:00Z', 22, 'clearsky_day', 0),   // 12:00 local (nearest noon)
      entry('2026-07-23T16:00:00Z', 20, 'lightrain', 0.6),    // 17:00 local, some rain
      entry('2026-07-23T20:00:00Z', 16, 'cloudy', 0),         // 21:00 local
      entry('2026-07-24T11:00:00Z', 30, 'clearsky_day', 0),   // TOMORROW - excluded
    ];
    expect(summariseMetnoToday(series, 'Europe/London', NOW)).toEqual({
      hi: 22, lo: 15, code: 0 /* clearsky_day nearest noon */, precipProbability: 60 /* 0.6mm */,
    });
  });

  test('no today entries → null (lets the caller fall through to wttr.in)', () => {
    const series = [entry('2026-07-24T11:00:00Z', 30, 'clearsky_day', 0)];
    expect(summariseMetnoToday(series, 'Europe/London', NOW)).toBeNull();
    expect(summariseMetnoToday([], 'Europe/London', NOW)).toBeNull();
    expect(summariseMetnoToday(undefined, 'Europe/London', NOW)).toBeNull();
  });

  test('dry day → 0% precip', () => {
    const series = [
      entry('2026-07-23T11:00:00Z', 24, 'fair_day', 0),
      entry('2026-07-23T14:00:00Z', 26, 'clearsky_day', 0),
    ];
    expect(summariseMetnoToday(series, 'Europe/London', NOW)).toMatchObject({ precipProbability: 0, code: 1 });
  });
});

describe('coordCacheKey', () => {
  test('nearby households (~1km apart) collapse to the same key → one fetch', () => {
    // The Schneiders (51.5894, -0.2334) and a neighbour ~1km away share a key.
    const schneiders = coordCacheKey(51.5893739, -0.2333729, 'Europe/London');
    const neighbour = coordCacheKey(51.5951, -0.2402, 'Europe/London');
    expect(schneiders).toBe(neighbour);
    expect(schneiders).toBe('51.6,-0.2@Europe/London');
  });

  test('different towns get different keys', () => {
    expect(coordCacheKey(51.59, -0.23, 'Europe/London'))
      .not.toBe(coordCacheKey(53.80, -1.55, 'Europe/London')); // London vs Leeds
  });

  test('same coords in different timezones do not collide', () => {
    expect(coordCacheKey(51.6, -0.2, 'Europe/London'))
      .not.toBe(coordCacheKey(51.6, -0.2, 'Europe/Paris'));
  });
});
