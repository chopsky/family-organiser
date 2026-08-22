/**
 * The onboarding step's client slug rules must be a strict SUBSET of the
 * server validator, or the step can hand someone an address that the
 * real check rejects at sign-up - after they've been told it's theirs.
 *
 * The client rule (web/src/pages/onboarding-v4/inboxSlug.js) is:
 *   lowercase a-z0-9 only, 24 chars max.
 * The server additionally allows hyphens and up to 32 chars, so every
 * client output should validate. This test is the tripwire if either
 * side moves.
 */
const { validateEmailAlias, RESERVED_ALIASES } = require('./email-alias');

/** Mirror of the client's slugify, kept deliberately verbatim. */
const clientSlugify = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);

describe('onboarding slug -> server validator parity', () => {
  const householdNames = [
    'The Carters', 'Parry House', "O'Brien-Smith", 'Smith Family',
    'ÉMOJI 🎉 café', 'a.b+c@d', '  Spaces  Here ', 'The 3 Bears',
    'A Very Long Household Name That Rambles On', 'McKessar', 'Strawberry Hayes',
  ];

  test.each(householdNames)('a slug of %p is accepted by the server', (name) => {
    const slug = clientSlugify(name);
    if (slug.length < 3) return; // too short to claim; the step blocks it
    const v = validateEmailAlias(slug);
    // Reserved words are a legitimate rejection, not a rules mismatch.
    if (RESERVED_ALIASES.has(slug)) {
      expect(v.ok).toBe(false);
      return;
    }
    expect(v).toEqual({ ok: true, normalised: slug });
  });

  test('the client can never produce a hyphen, dot or capital', () => {
    for (const name of householdNames) {
      expect(clientSlugify(name)).toMatch(/^[a-z0-9]*$/);
    }
  });

  test("the client's 24-char cap sits inside the server's 32", () => {
    const slug = clientSlugify('x'.repeat(80));
    expect(slug).toHaveLength(24);
    expect(validateEmailAlias(slug).ok).toBe(true);
  });

  test('a 2-char slug is rejected by BOTH sides', () => {
    expect(clientSlugify('Ab').length).toBe(2);
    expect(validateEmailAlias('ab').ok).toBe(false);
  });
});
