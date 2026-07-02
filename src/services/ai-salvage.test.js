/**
 * Prose-salvage tests for the classifier (separate file from ai.test.js).
 *
 * Real prod failure 2026-07-02: "Which Claude model?" made Sonnet 5 answer in
 * plain conversational prose instead of the JSON envelope, and the user got
 * "Sorry, the AI replied in a format I couldn't read". salvageProseAsChat
 * turns that prose into a chat-intent result so the answer is delivered.
 */
jest.mock('@anthropic-ai/sdk');

const { salvageProseAsChat } = require('./ai');

describe('salvageProseAsChat', () => {
  test('pure prose becomes a chat result carrying the prose verbatim', () => {
    const prose = "I'm built on one of Anthropic's Claude models - happy to help with whatever you need for the family!";
    const r = salvageProseAsChat(prose);
    expect(r).toEqual(expect.objectContaining({
      intent: 'chat',
      response_message: prose,
      tasks: [],
      shopping_items: [],
      calendar_event: null,
    }));
  });

  test('trims surrounding whitespace', () => {
    expect(salvageProseAsChat('  Hello there!  \n').response_message).toBe('Hello there!');
  });

  test('never salvages text containing braces - broken JSON must stay an error', () => {
    // A malformed action payload downgraded to chat would silently drop the
    // action while the prose claims it happened.
    expect(salvageProseAsChat('{"intent": "add", "tasks": [')).toBeNull();
    expect(salvageProseAsChat('Sure! {"intent": "chat"} extra')).toBeNull();
    expect(salvageProseAsChat('ends with }')).toBeNull();
  });

  test('empty / whitespace-only input is not salvageable', () => {
    expect(salvageProseAsChat('')).toBeNull();
    expect(salvageProseAsChat('   ')).toBeNull();
    expect(salvageProseAsChat(null)).toBeNull();
  });
});

describe('classifier prompt — identity questions stay in the JSON envelope', () => {
  const { CLASSIFICATION_SYSTEM } = require('./prompts');

  test('prompt covers the "which model" failure explicitly', () => {
    expect(CLASSIFICATION_SYSTEM).toContain('QUESTIONS ABOUT YOURSELF');
    expect(CLASSIFICATION_SYSTEM).toMatch(/built on Anthropic'?s Claude/i);
    expect(CLASSIFICATION_SYSTEM).toMatch(/not claim a specific version/i);
  });
});
