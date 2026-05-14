const { validateEmailAlias, isReservedAlias } = require('./email-alias');

describe('validateEmailAlias', () => {
  describe('accepts valid aliases', () => {
    const ok = ['shapiro', 'the-shapiros', 'family42', 'a3b', 'long-but-still-fine-alias'];
    ok.forEach((alias) => {
      it(`"${alias}"`, () => {
        const r = validateEmailAlias(alias);
        expect(r.ok).toBe(true);
        expect(r.normalised).toBe(alias.toLowerCase());
      });
    });
  });

  describe('rejects invalid aliases', () => {
    const cases = [
      { input: '', reason: /at least 3/ },
      { input: 'ab', reason: /at least 3/ },
      { input: 'a'.repeat(33), reason: /32 characters/ },
      { input: 'Shapiro!', reason: /lowercase/ },
      { input: '-leading', reason: /leading\/trailing hyphen|lowercase/ },
      { input: 'trailing-', reason: /leading\/trailing hyphen|lowercase/ },
      { input: 'has spaces', reason: /lowercase/ },
      { input: 'has.dots', reason: /lowercase/ },
      { input: 'has+plus', reason: /lowercase/ },
      { input: null, reason: /text/ },
      { input: undefined, reason: /text/ },
      { input: 42, reason: /text/ },
    ];
    cases.forEach(({ input, reason }) => {
      it(`rejects ${JSON.stringify(input)}`, () => {
        const r = validateEmailAlias(input);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(reason);
      });
    });
  });

  describe('rejects reserved aliases', () => {
    const reserved = ['admin', 'support', 'noreply', 'postmaster', 'housemait', 'api', 'system'];
    reserved.forEach((alias) => {
      it(`"${alias}"`, () => {
        const r = validateEmailAlias(alias);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/reserved/i);
      });
    });
  });

  it('normalises case', () => {
    expect(validateEmailAlias('Shapiro')).toEqual({ ok: true, normalised: 'shapiro' });
    expect(validateEmailAlias('  TheShapiros  ')).toEqual({ ok: true, normalised: 'theshapiros' });
  });
});

describe('isReservedAlias', () => {
  it('is true for reserved', () => {
    expect(isReservedAlias('admin')).toBe(true);
    expect(isReservedAlias('ADMIN')).toBe(true);
    expect(isReservedAlias(' support ')).toBe(true);
  });
  it('is false for safe', () => {
    expect(isReservedAlias('shapiro')).toBe(false);
    expect(isReservedAlias('')).toBe(false);
    expect(isReservedAlias(null)).toBe(false);
  });
});
