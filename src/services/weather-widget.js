/**
 * Dashboard weather widget data source.
 *
 * Distinct from digest-weather.js (which returns a daily summary for the
 * WhatsApp morning brief). This builds the richer payload the Home-screen
 * WeatherStrip needs: current conditions + a 24-hour forward forecast +
 * a context-aware AI note tying the weather to today's calendar.
 *
 * Location: household.address, geocoded via the shared weather.js
 * geocodeLocation (Open-Meteo geocoder → Photon fallback). Returns
 * { available:false } when no address is set, so the UI can render
 * nothing rather than a broken card.
 *
 * Provider: Open-Meteo (free, key-less). One call fetches current +
 * hourly + daily. The same upstream digest-weather.js uses, so we
 * inherit its reliability profile.
 *
 * Cache: 30 min per household. Weather barely moves inside that window,
 * and it bounds the AI-note LLM cost to at most ~48 calls/household/day.
 */

const { callWithFailover } = require('./ai-client');
const { geocodeLocation, reverseGeocode } = require('./weather');

const CACHE_TTL_MS = 30 * 60 * 1000;       // 30 min for a good payload
const NEG_CACHE_TTL_MS = 5 * 60 * 1000;    // 5 min for a failed fetch
const cache = new Map(); // householdId → { data, ts }

// ── WMO weather code → the 4 design buckets (sun | partly | cloud | rain) ──
// The widget's WX_COLOR + glyph set only knows these four. Collapse all
// rain/drizzle/shower/thunder → rain, overcast/fog → cloud, few-clouds →
// partly, clear → sun. Snow falls into cloud for now (the design doesn't
// ship a snow glyph; revisit if we add one).
function wmoToBucket(code) {
  if (code === 0 || code === 1) return 'sun';
  if (code === 2) return 'partly';
  if (code === 3 || code === 45 || code === 48) return 'cloud';
  if (code >= 51 && code <= 67) return 'rain';   // drizzle + rain
  if (code >= 71 && code <= 77) return 'cloud';  // snow → cloud (no snow glyph yet)
  if (code >= 80 && code <= 82) return 'rain';   // rain showers
  if (code >= 85 && code <= 86) return 'cloud';  // snow showers
  if (code >= 95) return 'rain';                 // thunderstorm
  return 'partly';                               // unknown → neutral
}

// Human label for the headline condition. Kept short (the design's
// "Partly sunny" register) rather than the emoji-laden WMO_CODES map
// weather.js uses for WhatsApp.
function conditionLabel(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly sunny';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rainy';
  if (code >= 71 && code <= 77) return 'Snowy';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Mixed';
}

async function fetchOpenMeteo(loc, tz) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,weather_code` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=${encodeURIComponent(tz)}&forecast_days=2`;

  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 250 : 750));
    try {
      res = await fetch(url);
      if (res.ok) break;
      lastErr = new Error(`Open-Meteo ${res.status}`);
      if (res.status < 500) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!res?.ok) throw lastErr || new Error('Open-Meteo unknown failure');
  return res.json();
}

/**
 * Build the 24-hour forward array starting at "Now". Open-Meteo returns
 * hourly arrays aligned to local midnight of forecast_days; we find the
 * index of the current hour and slice 24 entries forward (wrapping into
 * tomorrow, hence forecast_days=2).
 */
function buildHours(data, tz) {
  const times = data.hourly?.time || [];
  const temps = data.hourly?.temperature_2m || [];
  const codes = data.hourly?.weather_code || [];
  if (!times.length) return [];

  // "Now" = the hourly slot for the current local hour. Open-Meteo's
  // hourly times are local ISO strings (no Z) because we passed timezone.
  // Compare on the YYYY-MM-DDTHH prefix against the household-local now.
  const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: tz }); // "YYYY-MM-DD HH:MM:SS"
  const nowHourPrefix = nowLocal.slice(0, 13).replace(' ', 'T');         // "YYYY-MM-DDTHH"
  let startIdx = times.findIndex(t => t.slice(0, 13) >= nowHourPrefix);
  if (startIdx < 0) startIdx = 0;

  const out = [];
  for (let i = startIdx; i < times.length && out.length < 24; i++) {
    const hh = times[i].slice(11, 16); // "HH:MM"
    out.push({
      t: out.length === 0 ? 'Now' : hh,
      tmp: Math.round(temps[i]),
      icon: wmoToBucket(Number(codes[i])),
    });
  }
  return out;
}

/**
 * Generate the one-sentence AI note tying the forecast to today's events.
 * Best-effort: returns null on any failure (the UI hides the row when null).
 */
async function generateNote({ householdId, userId, city, label, hi, lo, rain, events }) {
  try {
    const eventLines = (events || [])
      .filter(e => !e.all_day && e.start_time)
      .slice(0, 6)
      .map(e => {
        const t = new Date(e.start_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${t} ${e.title}`;
      });
    // No timed events → a generic forecast nudge isn't worth an LLM call
    // or the row. Omit.
    if (eventLines.length === 0) return null;

    const system = 'You write a single short weather nudge for a family home screen. '
      + 'ONE sentence, 10 words or fewer, plain and actionable. Reference a specific '
      + 'event by name ONLY if the weather is relevant to it (rain before an outdoor '
      + 'event, warmth for a park trip, etc.). British spelling is fine, but plain '
      + 'words only - no regional slang ("umbrella", not "brolly"). No emoji. No quotes. '
      + 'Commas and full stops only - no em or en dashes (— –). '
      + 'If the weather is unremarkable for the day\'s events, reply with the single '
      + 'word SKIP and nothing else.';
    const user = `Weather in ${city}: ${label}, high ${hi}°C, low ${lo}°C, ${rain}% chance of rain.\n`
      + `Today's events:\n${eventLines.join('\n')}`;

    const { text } = await callWithFailover({
      system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 40,
      useThinking: false,
      feature: 'weather_note',
      householdId,
      userId,
    });
    const note = (text || '').trim().replace(/^["']|["']$/g, '');
    if (!note || /^skip$/i.test(note)) return null;
    return note;
  } catch (err) {
    console.warn('[weather-widget] note generation failed:', err.message);
    return null;
  }
}

/**
 * Build the full widget payload for a household.
 *
 * Location precedence: device GPS coords (passed from the iOS app, primary)
 * → household.address (secondary fallback). When neither is available the
 * payload is { available:false, reason:'no_location' } so the UI can prompt
 * the user to enable location or add an address.
 *
 * @param {object} household - { id, address, timezone }
 * @param {object} [opts] - { userId, events, coords } events = today's calendar
 *   events; coords = { lat, lon } device location (primary)
 * @returns {Promise<object>} { available, ...weather } | { available:false }
 */
async function getWeatherWidget(household, { userId, events, coords } = {}) {
  if (!household?.id) return { available: false };

  const hasCoords = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon);
  // Cache device-coords payloads by rounded position (so one member's GPS
  // weather isn't served to another household member on a different device),
  // and address payloads by household id (the address is shared).
  const cacheKey = hasCoords
    ? `c:${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
    : household.id;

  const cached = cache.get(cacheKey);
  if (cached) {
    const ttl = cached.data.available ? CACHE_TTL_MS : NEG_CACHE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.data;
  }

  // Resolve a location: device coords first (reverse-geocoded for a label),
  // then the household address.
  let loc = null;
  if (hasCoords) {
    const rev = await reverseGeocode(coords.lat, coords.lon);
    loc = { lat: coords.lat, lon: coords.lon, name: rev?.name || 'your location', timezone: null };
  } else if (household.address?.trim()) {
    loc = await geocodeLocation(household.address.trim());
    if (!loc) {
      const payload = { available: false, reason: 'geocode_failed' };
      cache.set(cacheKey, { data: payload, ts: Date.now() });
      return payload;
    }
  } else {
    // No device location and no saved address → nothing to show.
    const payload = { available: false, reason: 'no_location' };
    cache.set(cacheKey, { data: payload, ts: Date.now() });
    return payload;
  }

  const tz = household.timezone || loc.timezone || 'auto';
  let data;
  try {
    data = await fetchOpenMeteo(loc, tz);
  } catch (err) {
    console.warn(`[weather-widget] fetch failed for household ${household.id}: ${err.message}`);
    const payload = { available: false, reason: 'fetch_failed' };
    cache.set(cacheKey, { data: payload, ts: Date.now() });
    return payload;
  }

  const currentCode = Number(data.current?.weather_code);
  const daily = data.daily || {};
  const hi = Math.round(daily.temperature_2m_max?.[0]);
  const lo = Math.round(daily.temperature_2m_min?.[0]);
  const rain = daily.precipitation_probability_max?.[0] ?? 0;
  const label = conditionLabel(currentCode);

  const note = await generateNote({
    householdId: household.id,
    userId,
    city: loc.name || 'home',
    label,
    hi,
    lo,
    rain,
    events,
  });

  const payload = {
    available: true,
    city: loc.name || 'home',
    now: Math.round(data.current?.temperature_2m),
    cond: label,
    icon: wmoToBucket(currentCode),
    high: hi,
    low: lo,
    rain,
    note, // null → UI hides the row
    hours: buildHours(data, tz),
  };
  cache.set(cacheKey, { data: payload, ts: Date.now() });
  return payload;
}

function invalidateWeatherWidgetCache(householdId) {
  if (householdId) cache.delete(householdId);
}

module.exports = { getWeatherWidget, invalidateWeatherWidgetCache, wmoToBucket, conditionLabel };
