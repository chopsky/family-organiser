/**
 * Keyword gates for conditional classify context (Phase 3). Generous by
 * design (a false positive costs tokens, a false negative costs an "I don't
 * know") — these tests pin the everyday phrasings and the obvious negatives.
 */
const { messageMentionsMeals, messageMentionsShopping, messageMentionsStars } = require('./context-relevance');

test.each([
  "what's for dinner tomorrow?",
  'what are we eating this week',
  'give me an easy recipe',
  'plan a meal for Thursday',
])('meals gate fires: %s', (msg) => expect(messageMentionsMeals(msg)).toBe(true));

test.each([
  "what's on the shopping list?",
  'did we buy milk?',
  "we're running out of nappies",
  'add eggs before the Tesco run',
])('shopping gate fires: %s', (msg) => expect(messageMentionsShopping(msg)).toBe(true));

test.each([
  'how many stars does Olivia have?',
  'has Henry done his chores today',
  'what rewards can the kids get',
])('stars gate fires: %s', (msg) => expect(messageMentionsStars(msg)).toBe(true));

test.each([
  'move the dentist to 4pm',
  'remind me to call the plumber',
  'will it rain tomorrow?',
])('none of the gates fire on unrelated messages: %s', (msg) => {
  expect(messageMentionsMeals(msg)).toBe(false);
  expect(messageMentionsShopping(msg)).toBe(false);
  expect(messageMentionsStars(msg)).toBe(false);
});
