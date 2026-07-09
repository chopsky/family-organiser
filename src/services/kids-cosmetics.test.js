const { COSMETICS, getCosmetic, inSeason, getCatalogue } = require('./kids-cosmetics');

describe('kids-cosmetics catalogue', () => {
  test('every entry has a key, kind and a non-negative cost', () => {
    for (const c of COSMETICS) {
      expect(typeof c.key).toBe('string');
      expect(['theme', 'sticker']).toContain(c.kind);
      expect(c.cost).toBeGreaterThanOrEqual(0);
    }
  });

  test('keys are unique', () => {
    const keys = COSMETICS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('getCosmetic resolves by key, null for unknown', () => {
    expect(getCosmetic('galaxy')).toMatchObject({ kind: 'theme' });
    expect(getCosmetic('nope')).toBeNull();
  });
});

describe('inSeason', () => {
  const summer = { season: { from: '06-01', to: '08-31' } };
  const yearWrap = { season: { from: '12-01', to: '01-15' } };

  test('non-seasonal items are always in season', () => {
    expect(inSeason({}, '01-01')).toBe(true);
    expect(inSeason(getCosmetic('sticker_rainbow'), '03-14')).toBe(true);
  });

  test('a summer window is in season only Jun–Aug', () => {
    expect(inSeason(summer, '07-09')).toBe(true);
    expect(inSeason(summer, '06-01')).toBe(true);
    expect(inSeason(summer, '08-31')).toBe(true);
    expect(inSeason(summer, '05-31')).toBe(false);
    expect(inSeason(summer, '09-01')).toBe(false);
  });

  test('a year-wrapping window includes both ends', () => {
    expect(inSeason(yearWrap, '12-25')).toBe(true);
    expect(inSeason(yearWrap, '01-10')).toBe(true);
    expect(inSeason(yearWrap, '11-30')).toBe(false);
    expect(inSeason(yearWrap, '01-16')).toBe(false);
  });
});

describe('getCatalogue', () => {
  test('stamps inSeason for the given day and keeps cost/kind', () => {
    const cat = getCatalogue('07-09');
    const summer = cat.find((c) => c.key === 'sticker_summer');
    expect(summer).toMatchObject({ kind: 'sticker', seasonal: true, inSeason: true });
    const winter = getCatalogue('01-15').find((c) => c.key === 'sticker_summer');
    expect(winter.inSeason).toBe(false);
    // non-seasonal item always in season, not flagged seasonal
    const rainbow = cat.find((c) => c.key === 'sticker_rainbow');
    expect(rainbow).toMatchObject({ seasonal: false, inSeason: true });
  });
});
