const {
  formatPreferenceLines,
  formatRecipeConstraints,
  householdAllergiesToPreferences,
  mergeHouseholdAllergies,
} = require('./preferences-format');

describe('formatPreferenceLines (classifier + chat block)', () => {
  test('groups hardest-first and attributes to the member', () => {
    const out = formatPreferenceLines([
      { key: 'like', value: 'pasta', member_name: 'Mason' },
      { key: 'allergy', value: 'nuts', member_name: 'Lynn' },
      { key: 'schedule', value: 'Tuesdays are soccer', member_id: null },
    ]);
    expect(out).toBe(
      '- [ALLERGY] Lynn: nuts\n'
      + '- [LIKE] Mason: pasta\n'
      + '- [SCHEDULE] Everyone: Tuesdays are soccer',
    );
  });

  test('a member_id with no resolved name falls back to (member), null is Everyone', () => {
    const out = formatPreferenceLines([
      { key: 'dislike', value: 'olives', member_id: 'm-1' },
      { key: 'dietary', value: 'no pork', member_id: null },
    ]);
    expect(out).toBe('- [DIETARY] Everyone: no pork\n- [DISLIKE] (member): olives');
  });

  test('empty list yields the placeholder', () => {
    expect(formatPreferenceLines([])).toBe('(none saved yet)');
    expect(formatPreferenceLines(null, '(nothing)')).toBe('(nothing)');
  });
});

describe('formatRecipeConstraints', () => {
  test('partitions into hard/soft/bias, dropping member attribution', () => {
    const out = formatRecipeConstraints([
      { key: 'allergy', value: 'nuts', member_name: 'Lynn' },
      { key: 'dietary', value: 'vegetarian', member_id: null },
      { key: 'dislike', value: 'mushrooms', member_name: 'Mason' },
      { key: 'like', value: 'pasta', member_name: 'Mason' },
      { key: 'schedule', value: 'Tuesdays are soccer', member_id: null },
    ]);
    expect(out).toMatch(/ALLERGIES \(NEVER include[^\n]*\): nuts/);
    expect(out).toMatch(/DIETARY RULES \(must respect\): vegetarian/);
    expect(out).toMatch(/DISLIKES[^\n]*: mushrooms/);
    expect(out).toMatch(/LIKES[^\n]*: pasta/);
    // schedule is irrelevant to a recipe - never rendered
    expect(out).not.toMatch(/soccer/);
    expect(out).toMatch(/hard safety constraints/);
  });

  test('de-dupes values case-insensitively', () => {
    const out = formatRecipeConstraints([
      { key: 'allergy', value: 'Nuts' },
      { key: 'allergy', value: 'nuts' },
      { key: 'allergy', value: 'shellfish' },
    ]);
    expect(out).toMatch(/ALLERGIES[^\n]*: Nuts, shellfish/);
  });

  test('returns empty string when nothing recipe-relevant is saved', () => {
    expect(formatRecipeConstraints([])).toBe('');
    expect(formatRecipeConstraints([{ key: 'schedule', value: 'soccer' }])).toBe('');
    expect(formatRecipeConstraints([{ key: 'preference', value: 'likes round plates' }])).toBe('');
  });

  test('omits bullet lines for sections with no values', () => {
    // The intro sentence names ALLERGIES/DIETARY RULES as categories, so match
    // the bullet lines specifically rather than the words anywhere.
    const out = formatRecipeConstraints([{ key: 'allergy', value: 'nuts' }]);
    expect(out).toMatch(/- ALLERGIES/);
    expect(out).not.toMatch(/- DIETARY RULES/);
    expect(out).not.toMatch(/- DISLIKES/);
    expect(out).not.toMatch(/- LIKES/);
  });
});

describe('householdAllergiesToPreferences (Family-page chips)', () => {
  test('maps allergen keys to allergy rows and diet keys to dietary rows', () => {
    const out = householdAllergiesToPreferences(['gluten', 'peanuts', 'vegan']);
    expect(out).toEqual([
      { key: 'allergy', value: 'Gluten', member_id: null, member_name: null, source: 'household' },
      { key: 'allergy', value: 'Peanuts', member_id: null, member_name: null, source: 'household' },
      { key: 'dietary', value: 'Vegan', member_id: null, member_name: null, source: 'household' },
    ]);
  });

  test('accepts a JSON string, ignores unknown keys, tolerates junk', () => {
    expect(householdAllergiesToPreferences('["nuts","bogus"]')).toEqual([
      { key: 'allergy', value: 'Tree nuts', member_id: null, member_name: null, source: 'household' },
    ]);
    expect(householdAllergiesToPreferences(null)).toEqual([]);
    expect(householdAllergiesToPreferences('not json')).toEqual([]);
    expect(householdAllergiesToPreferences(undefined)).toEqual([]);
  });
});

describe('mergeHouseholdAllergies', () => {
  test('appends chips to learned preferences', () => {
    const merged = mergeHouseholdAllergies(
      [{ key: 'dislike', value: 'mushrooms', member_name: 'Mason' }],
      ['gluten'],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.value === 'Gluten')).toMatchObject({ key: 'allergy' });
  });

  test('de-dupes a chip that a learned row already covers (case-insensitive)', () => {
    const merged = mergeHouseholdAllergies(
      [{ key: 'allergy', value: 'gluten', member_name: 'Lynn' }],
      ['gluten'],
    );
    const glutens = merged.filter((p) => p.key === 'allergy' && p.value.toLowerCase() === 'gluten');
    expect(glutens).toHaveLength(1);
  });

  test('formatRecipeConstraints surfaces a chip-only allergen', () => {
    const out = formatRecipeConstraints(mergeHouseholdAllergies([], ['gluten', 'vegan']));
    expect(out).toMatch(/- ALLERGIES[^\n]*Gluten/);
    expect(out).toMatch(/- DIETARY RULES[^\n]*Vegan/);
  });
});
