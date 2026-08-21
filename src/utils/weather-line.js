/**
 * Build the "calm-friend" weather one-liner for the WhatsApp morning
 * digest (Variation C from the design discussion).
 *
 * Goals:
 *   • Sound like a real person, not a chart row. "Wet day in Bristol"
 *     beats "🌧 Bristol: 18°C, 60% rain".
 *   • Interpret the forecast into one actionable nudge, in UNIVERSAL
 *     English - the app ships outside the UK, so "umbrella", never
 *     "brolly" (founder call, 2026-08-21).
 *   • Vary the nudge day to day: the same phrase on every rainy morning
 *     reads like a template. The pick rotates on the epoch day, so it's
 *     deterministic within a day (testable, and every household hears
 *     the same voice) but different across a rainy week.
 *   • A location label that is literally "home" would read "wet day in
 *     home" (real screenshot) - such labels get location-less phrasing.
 *   • Return null when there's nothing useful to say - better to omit
 *     than to pad with a generic "mild" line every day.
 *
 * Pure function; all weather fetching happens elsewhere. Easy to test.
 *
 * @param {object} forecast - shape:
 *   { cityName: string,
 *     code:    number  - Open-Meteo / WMO daily weather code
 *     hi:      number  - high in °C (rounded)
 *     lo:      number  - low in °C (rounded)
 *     precipProbability: number  - 0-100 %
 *   }
 * @param {Date} [now] - injectable for tests; picks the day's nudge.
 * @returns {string|null} The one-liner, or null if nothing notable.
 */

const RAIN_NUDGES = [
  'worth an umbrella',
  'take an umbrella',
  "an umbrella wouldn't hurt",
  'pack an umbrella',
];
const HEAVY_RAIN_NUDGES = [
  'umbrella all day',
  'stay dry out there',
  'a real umbrella day',
];

function buildDigestWeatherLine(forecast, now = new Date()) {
  if (!forecast || !forecast.cityName) return null;
  const { cityName, code, hi, precipProbability } = forecast;

  // Generic labels ("home") make broken sentences; drop the place instead.
  const place = /^(my )?home$/i.test(String(cityName).trim()) ? null : cityName;
  const at = place ? ` in ${place}` : '';

  const dayIdx = Math.floor(now.getTime() / 86_400_000);
  const pick = (arr) => arr[dayIdx % arr.length];

  // New phrasing per user redesign: lead with the temperature (the most
  // glance-able fact), then the condition + actionable nudge if any.
  // "23°C, mild and cloudy in London today." beats "Mild and cloudy in
  // London - 23°C high." for scannability.

  // 1. Thunderstorms / heavy stuff first
  if (code === 95 || code === 96 || code === 99) {
    return `⛈ ${hi}°C, thunderstorms${at} today, keep an eye on it.`;
  }

  // 2. Snow
  if (code === 71 || code === 73 || code === 75 || code === 85 || code === 86) {
    return `❄️ ${hi}°C, snow${at} today, wrap up warm.`;
  }

  // 3. Heavy rain
  // Cross-check probability: Open-Meteo's daily weather_code is the
  // "most severe condition of the day" - a single forecast hour with
  // a heavy-rain marker can flip the daily code to 65 even when the
  // probability for the day as a whole is near zero. Gate on a high
  // probability so we don't tell users to brace for a downpour when
  // there's no real chance of rain.
  if (code === 65 || code === 82 || code === 55) {
    if (precipProbability >= 50) {
      return `🌧 ${hi}°C, heavy rain${at}, ${pick(HEAVY_RAIN_NUDGES)}.`;
    }
    // Probability too low to trust the code - fall through to the
    // temperature / cloud branches below.
  }

  // 4. Light/moderate rain - same probability gate, lower threshold.
  // Without this gate the "wet day" line was firing on days with 0%
  // chance of rain because Open-Meteo had picked up a single hour of
  // possible drizzle in its daily aggregate.
  if (code === 61 || code === 63 || code === 80 || code === 81 || code === 51 || code === 53) {
    if (precipProbability >= 30) {
      return `🌦 ${hi}°C, wet day${at} (${precipProbability}% chance), ${pick(RAIN_NUDGES)}.`;
    }
    // Probability too low - fall through.
  }

  // 5. Fog
  if (code === 45 || code === 48) {
    return `🌫 ${hi}°C, foggy start${at}, should clear later.`;
  }

  // 6. Temperature extremes (only if we got past the wet codes)
  if (hi >= 28) {
    return `☀️ ${hi}°C, hot one${at} today, plenty of water.`;
  }
  if (hi <= 3) {
    return `🥶 ${hi}°C, cold day${at}, layers.`;
  }

  // 7. Pleasant clear/sunny
  if (code === 0 || code === 1) {
    return `☀️ ${hi}°C, sunny${at} today.`;
  }

  // 8. Partly cloudy / overcast - always include so users know what
  //    to expect on the way out. Phrasing splits by warmth.
  if (code === 2 || code === 3) {
    const adj = code === 2 ? 'partly cloudy' : 'cloudy';
    if (hi >= 20) return `🌤 ${hi}°C, mild and ${adj}${at} today.`;
    if (hi >= 12) return `🌤 ${hi}°C, ${adj}${at} today.`;
    return `🌤 ${hi}°C, cool and ${adj}${at} today.`;
  }

  // 9. Catch-all - never omit, even for unknown WMO codes. People
  //    want to glance at the digest and know what to wear.
  return `🌤 ${hi}°C${at} today.`;
}

module.exports = { buildDigestWeatherLine, RAIN_NUDGES, HEAVY_RAIN_NUDGES };
