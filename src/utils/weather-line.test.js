const { buildDigestWeatherLine } = require('./weather-line');

// Open-Meteo's daily weather_code aggregates to the most-severe condition
// across the 24h day, so a single hour of possible drizzle can flip the
// daily code to 61/63 even when precipitation_probability_max for the
// whole day is near zero. These tests lock in the probability gate that
// stops "wet day" from firing in that case.
describe('buildDigestWeatherLine', () => {
  describe('rain branches gate on probability', () => {
    it('does NOT say "wet day" when code is light-rain but probability is 0', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 61,                  // light rain
        hi: 22,
        precipProbability: 0,
      });
      expect(line).not.toMatch(/wet day/);
      expect(line).not.toMatch(/brolly/);
    });

    it('does NOT say "wet day" when probability is below the 30% threshold', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 63,
        hi: 22,
        precipProbability: 20,
      });
      expect(line).not.toMatch(/wet day/);
    });

    it('DOES say "wet day" when probability meets the 30% threshold', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 61,
        hi: 18,
        precipProbability: 40,
      });
      expect(line).toMatch(/wet day in London/);
      expect(line).toMatch(/40% chance/);
      expect(line).toMatch(/brolly/);
    });

    it('does NOT say "heavy rain" when probability is below the 50% threshold', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 65,                  // heavy rain
        hi: 18,
        precipProbability: 30,
      });
      expect(line).not.toMatch(/heavy rain/);
    });

    it('DOES say "heavy rain" when probability meets the 50% threshold', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 65,
        hi: 18,
        precipProbability: 70,
      });
      expect(line).toMatch(/heavy rain in London/);
      expect(line).toMatch(/brolly all day/);
    });
  });

  describe('falls through to sensible alternative when rain gate fails', () => {
    it('hot day takes over when rain probability is 0 but hi is high', () => {
      // The exact bug from this morning: "33°C, wet day in London — worth a brolly"
      // with no actual rain forecast. Should now read as the hot-day line.
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 61,
        hi: 33,
        precipProbability: 0,
      });
      expect(line).toMatch(/hot one in London/);
      expect(line).toMatch(/plenty of water/);
      expect(line).not.toMatch(/wet day/);
      expect(line).not.toMatch(/brolly/);
    });

    it('catch-all line fires for a mild day with low rain probability', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 80,                  // rain showers
        hi: 18,
        precipProbability: 10,
      });
      // Generic line - no "wet day", no "brolly".
      expect(line).not.toMatch(/wet day/);
      expect(line).not.toMatch(/brolly/);
      expect(line).toContain('London');
      expect(line).toContain('18°C');
    });
  });

  describe('non-rain branches unaffected', () => {
    it('thunderstorms always fire regardless of probability', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 95,
        hi: 20,
        precipProbability: 0,
      });
      expect(line).toMatch(/thunderstorms in London/);
    });

    it('sunny day with code 0', () => {
      const line = buildDigestWeatherLine({
        cityName: 'London',
        code: 0,
        hi: 22,
        precipProbability: 0,
      });
      expect(line).toMatch(/sunny in London/);
    });
  });
});
