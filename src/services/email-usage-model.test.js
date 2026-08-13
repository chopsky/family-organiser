/**
 * usageToTemplateModel - the trial-nudge stats block must never brag
 * about zeros ("0 shopping list items" in a save-your-trial email).
 * Zero counts are omitted so the templates' {{#field}} row conditionals
 * hide them, and has_usage gates the whole block.
 */

jest.mock('./unsubscribe-token', () => ({ unsubscribeUrl: jest.fn(() => 'https://example.com/u') }));

const { usageToTemplateModel } = require('./email');

describe('usageToTemplateModel', () => {
  test('never-started household: no count fields, has_usage false', () => {
    const model = usageToTemplateModel({
      shopping_item_count: 0, meal_plan_count: 0, task_count: 0,
      calendar_event_count: 0, member_count: 1,
    });
    expect(model).toEqual({ has_usage: false });
  });

  test('missing usage object behaves like all-zero', () => {
    expect(usageToTemplateModel(null)).toEqual({ has_usage: false });
    expect(usageToTemplateModel(undefined)).toEqual({ has_usage: false });
  });

  test('active household: positive counts pass through, has_usage true', () => {
    const model = usageToTemplateModel({
      shopping_item_count: 12, meal_plan_count: 5, task_count: 0,
      calendar_event_count: 8, member_count: 4,
    });
    expect(model).toEqual({
      items_added: 12, meals_planned: 5, events_added: 8,
      family_members_count: 4, has_usage: true,
    });
    expect(model.tasks_completed).toBeUndefined(); // zero row hidden
  });

  test('a lone signer-upper does not count as family usage', () => {
    // member_count 1 is just the account creator - with nothing else,
    // the block must fall back rather than show "1 family members".
    const model = usageToTemplateModel({ member_count: 1, shopping_item_count: 0 });
    expect(model).toEqual({ has_usage: false });
  });
});
