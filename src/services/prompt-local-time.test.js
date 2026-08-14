/**
 * Guards the single most expensive class of AI bug in this app: a prompt that
 * lets the model pre-convert an event time to UTC, after which localToUTC
 * converts it a second time and the family arrives an hour early.
 *
 * This is a PARITY test, not a wording test. The rule was written correctly in
 * EMAIL_EXTRACTION_SYSTEM and then simply never copied into IMAGE_SCAN_SYSTEM,
 * which is how a photographed "4:45pm" party invite got stored as 14:45Z in
 * Aug 2026. Any NEW prompt that extracts a start_time fails here until it
 * carries the same rule, so the fix cannot be forgotten in one path again.
 */

const prompts = require('./prompts');
const { LOCAL_TIME_RULE } = prompts;

// Every exported prompt string that asks the model for an event start_time.
const timeExtractingPrompts = Object.entries(prompts).filter(
  ([name, value]) =>
    name !== 'LOCAL_TIME_RULE' && typeof value === 'string' && value.includes('start_time')
);

describe('local wall-clock rule', () => {
  it('finds the prompts it is meant to be guarding', () => {
    // Sanity check: if this drops to zero the filter above has silently
    // stopped matching and every assertion below would vacuously pass.
    const names = timeExtractingPrompts.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'CLASSIFICATION_SYSTEM',
        'CHAT_ASSISTANT_SYSTEM',
        'IMAGE_SCAN_SYSTEM',
        'EMAIL_EXTRACTION_SYSTEM',
      ])
    );
  });

  it.each(timeExtractingPrompts.map(([name]) => name))(
    '%s tells the model not to convert timezones',
    (name) => {
      expect(prompts[name]).toContain(LOCAL_TIME_RULE);
    }
  );

  it('forbids inferring a timezone from a venue address', () => {
    // The actual failure mode: the invite said "Laser Quest Hatfield", the
    // model inferred UK/BST and helpfully subtracted an hour by itself.
    expect(LOCAL_TIME_RULE).toMatch(/address|venue|postcode/i);
  });

  it('stays placeholder-free so prompt caching still hits', () => {
    // CLASSIFICATION_SYSTEM must be byte-identical across calls; a runtime
    // {{PLACEHOLDER}} in here would bust the ~87% input-token saving.
    expect(LOCAL_TIME_RULE).not.toMatch(/\{\{|\$\{/);
  });
});
