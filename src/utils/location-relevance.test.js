const { messageMentionsLocation } = require('./location-relevance');

describe('messageMentionsLocation', () => {
  describe('returns true for location-relevant messages', () => {
    const positiveCases = [
      'Suggest an Italian restaurant near home',
      'any good cafés around here',
      'find a GP close by',
      'is there a dentist nearby',
      'recommend a pub for Saturday',
      'what are some kids-friendly activities',
      'where can I get a coffee',
      'where should we go for dinner this weekend',
      'find me a playground around the corner',
      'any decent restaurants in our area',
      'family-friendly day trip ideas',
      'date night spot suggestions',
      "what's a good walking distance pub",
      'any pharmacies near me',
      'museums to visit',
      "we need a hairdresser",
      'recommend a Thai takeaway',
      'where to take the kids this weekend',
    ];
    positiveCases.forEach((msg) => {
      it(`"${msg}"`, () => {
        expect(messageMentionsLocation(msg)).toBe(true);
      });
    });
  });

  describe('returns false for unrelated messages', () => {
    const negativeCases = [
      "what's on my calendar today",
      'remind me to call the bank tomorrow',
      'add milk to the shopping list',
      'when is the next school holiday',
      "what's the weather in Brighton tomorrow",
      'set a reminder for 3pm',
      'show me my tasks',
      'how much milk do we have',
      'cancel my Friday dinner reservation', // doesn't ask for one new
      'good morning',
      "what's Sarah doing tomorrow",
      'check the door is locked',
      'mark the milk as bought',
      '',
      null,
      undefined,
    ];
    negativeCases.forEach((msg) => {
      it(`"${msg ?? '(empty)'}"`, () => {
        expect(messageMentionsLocation(msg)).toBe(false);
      });
    });
  });

  it('is case-insensitive', () => {
    expect(messageMentionsLocation('SUGGEST A RESTAURANT NEARBY')).toBe(true);
    expect(messageMentionsLocation('Where Can I Get Coffee')).toBe(true);
  });
});
