/**
 * Build the "calm-friend" weather one-liner for the WhatsApp morning
 * digest (Variation C from the design discussion).
 *
 * Goals:
 *   • Sound like a real person, not a chart row. "Wet day in Bristol"
 *     beats "🌧 Bristol: 18°C, 60% rain".
 *   • Interpret the forecast into one actionable nudge ("worth a
 *     brolly", "plenty of water").
 *   • Return null when there's nothing useful to say — better to omit
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
 * @returns {string|null} The one-liner, or null if nothing notable.
 */
function buildDigestWeatherLine(forecast) {
  if (!forecast || !forecast.cityName) return null;
  const { cityName, code, hi, lo, precipProbability } = forecast;
  const city = cityName;

  // Severity buckets, ordered roughly most-actionable first. Each
  // returns either a sentence or null (meaning "this branch doesn't
  // apply, try the next one").

  // 1. Thunderstorms / heavy stuff first
  if (code === 95 || code === 96 || code === 99) {
    return `⛈ Thunderstorms in ${city} today — keep an eye on it. ${hi}° / ${lo}°.`;
  }

  // 2. Snow
  if (code === 71 || code === 73 || code === 75 || code === 85 || code === 86) {
    return `❄️ Snow in ${city} today — wrap up warm. ${hi}° / ${lo}°.`;
  }

  // 3. Heavy rain
  if (code === 65 || code === 82 || code === 55) {
    return `🌧 Heavy rain in ${city} — worth a brolly all day. ${hi}° / ${lo}°.`;
  }

  // 4. Light/moderate rain — chance-of-rain matters
  if (code === 61 || code === 63 || code === 80 || code === 81 || code === 51 || code === 53) {
    const chance = precipProbability && precipProbability >= 20 ? ` (${precipProbability}% chance)` : '';
    return `🌦 Wet day in ${city} — rain on and off${chance}. Worth a brolly. ${hi}°C high.`;
  }

  // 5. Fog
  if (code === 45 || code === 48) {
    return `🌫 Foggy start in ${city} — should clear later. ${hi}°C high.`;
  }

  // 6. Temperature extremes (only if we got past the wet codes)
  if (hi >= 28) {
    return `☀️ Hot one in ${city} — ${hi}°C and sunny. Plenty of water.`;
  }
  if (hi <= 3) {
    return `🥶 Cold day in ${city} — ${hi}°C high. Layers.`;
  }

  // 7. Pleasant clear/sunny
  if (code === 0 || code === 1) {
    return `☀️ Sunny in ${city} today — ${hi}°C high.`;
  }

  // 8. Partly cloudy + warm → still worth mentioning if it's nice out
  if ((code === 2 || code === 3) && hi >= 20) {
    return `🌤 Mild and ${code === 2 ? 'partly cloudy' : 'cloudy'} in ${city} — ${hi}°C high.`;
  }

  // 9. Nothing actionable — omit the line entirely.
  return null;
}

module.exports = { buildDigestWeatherLine };
