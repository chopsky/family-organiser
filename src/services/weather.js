/**
 * Weather service using Open-Meteo (free, no API key required).
 */

const WMO_CODES = {
  0: 'Clear sky ☀️',
  1: 'Mainly clear 🌤️',
  2: 'Partly cloudy ⛅',
  3: 'Overcast ☁️',
  45: 'Foggy 🌫️',
  48: 'Depositing rime fog 🌫️',
  51: 'Light drizzle 🌦️',
  53: 'Moderate drizzle 🌦️',
  55: 'Dense drizzle 🌧️',
  61: 'Slight rain 🌦️',
  63: 'Moderate rain 🌧️',
  65: 'Heavy rain 🌧️',
  71: 'Slight snow 🌨️',
  73: 'Moderate snow 🌨️',
  75: 'Heavy snow ❄️',
  80: 'Slight rain showers 🌦️',
  81: 'Moderate rain showers 🌧️',
  82: 'Violent rain showers ⛈️',
  85: 'Slight snow showers 🌨️',
  86: 'Heavy snow showers ❄️',
  95: 'Thunderstorm ⛈️',
  96: 'Thunderstorm with slight hail ⛈️',
  99: 'Thunderstorm with heavy hail ⛈️',
};

function describeWeatherCode(code) {
  return WMO_CODES[code] || 'Unknown';
}

/**
 * Parse a target day from the user's message (e.g. "Tuesday", "tomorrow", "this weekend").
 * Returns a Date object for the target day, or null if asking about today/general.
 */
function parseTargetDay(message, referenceDate) {
  if (!message) return null;
  const msg = message.toLowerCase().trim();
  const ref = referenceDate || new Date();

  // "today" or general weather question — return null (show default)
  if (/\btoday\b/.test(msg) || !/\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week|weekend)\b/.test(msg)) {
    return null;
  }

  if (/\btomorrow\b/.test(msg)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    return d;
  }

  if (/\bweekend\b/.test(msg)) {
    // Return Saturday
    const d = new Date(ref);
    const dayOfWeek = d.getDay();
    const daysUntilSat = (6 - dayOfWeek + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    return d;
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (msg.includes(dayNames[i])) {
      const d = new Date(ref);
      const currentDay = d.getDay();
      let daysAhead = (i - currentDay + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // Next occurrence, not today
      d.setDate(d.getDate() + daysAhead);
      return d;
    }
  }

  return null;
}

/**
 * Fetch weather for given coordinates.
 * @param {number} lat
 * @param {number} lon
 * @param {string} timezone - IANA timezone string
 * @param {object} options - { targetDate, userMessage }
 * @returns {Promise<string>} Formatted weather report
 */
async function getWeatherReport(lat, lon, timezone = 'auto', options = {}) {
  const { targetDate, userMessage } = options;

  // Determine the target day from the user's message
  const target = targetDate || parseTargetDay(userMessage);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=${encodeURIComponent(timezone)}&forecast_days=7`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status}`);
  }

  const data = await res.json();
  const current = data.current;
  const daily = data.daily;

  // If asking about a specific future day
  if (target) {
    const targetStr = target.toISOString().split('T')[0];
    const targetIdx = daily.time.indexOf(targetStr);

    if (targetIdx >= 0) {
      const dayLabel = target.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      const hi = Math.round(daily.temperature_2m_max[targetIdx]);
      const lo = Math.round(daily.temperature_2m_min[targetIdx]);
      const rain = daily.precipitation_probability_max[targetIdx];
      const desc = describeWeatherCode(daily.weather_code[targetIdx]);

      const lines = [
        `**${dayLabel}:**`,
        `${desc}`,
        `🌡️ ${lo}°–${hi}°C${rain > 20 ? ` · 🌧️ ${rain}% chance of rain` : ''}`,
      ];

      // Also show the day before and after for context if available
      const prevIdx = targetIdx - 1;
      const nextIdx = targetIdx + 1;
      if (prevIdx >= 0 || nextIdx < daily.time.length) {
        lines.push('');
        if (prevIdx >= 0) {
          const prevLabel = new Date(daily.time[prevIdx]).toLocaleDateString('en-GB', { weekday: 'long' });
          const prevDesc = describeWeatherCode(daily.weather_code[prevIdx]);
          const prevHi = Math.round(daily.temperature_2m_max[prevIdx]);
          const prevLo = Math.round(daily.temperature_2m_min[prevIdx]);
          const prevRain = daily.precipitation_probability_max[prevIdx];
          lines.push(`${prevLabel}: ${prevDesc} ${prevLo}°–${prevHi}°C${prevRain > 20 ? ` · 🌧️ ${prevRain}% rain` : ''}`);
        }
        if (nextIdx < daily.time.length) {
          const nextLabel = new Date(daily.time[nextIdx]).toLocaleDateString('en-GB', { weekday: 'long' });
          const nextDesc = describeWeatherCode(daily.weather_code[nextIdx]);
          const nextHi = Math.round(daily.temperature_2m_max[nextIdx]);
          const nextLo = Math.round(daily.temperature_2m_min[nextIdx]);
          const nextRain = daily.precipitation_probability_max[nextIdx];
          lines.push(`${nextLabel}: ${nextDesc} ${nextLo}°–${nextHi}°C${nextRain > 20 ? ` · 🌧️ ${nextRain}% rain` : ''}`);
        }
      }

      return lines.join('\n');
    }
    // Target day not in forecast range — fall through to default
  }

  // Default: current conditions + 3-day forecast
  const lines = [
    `🌡️ **Right now:** ${Math.round(current.temperature_2m)}°C (feels like ${Math.round(current.apparent_temperature)}°C)`,
    `${describeWeatherCode(current.weather_code)}`,
    `💨 Wind: ${Math.round(current.wind_speed_10m)} km/h · 💧 Humidity: ${current.relative_humidity_2m}%`,
    '',
  ];

  // 3-day forecast
  const dayNames = ['Today', 'Tomorrow'];
  for (let i = 0; i < Math.min(3, daily.time.length); i++) {
    const dayLabel = i < 2 ? dayNames[i] : new Date(daily.time[i]).toLocaleDateString('en-GB', { weekday: 'long' });
    const hi = Math.round(daily.temperature_2m_max[i]);
    const lo = Math.round(daily.temperature_2m_min[i]);
    const rain = daily.precipitation_probability_max[i];
    const desc = describeWeatherCode(daily.weather_code[i]);

    lines.push(`**${dayLabel}:** ${desc} ${lo}°–${hi}°C${rain > 20 ? ` · 🌧️ ${rain}% rain` : ''}`);
  }

  return lines.join('\n');
}

/**
 * Extract a location name from a weather query.
 * e.g. "what's the weather in Cape Town?" → "Cape Town"
 */
function extractLocationFromMessage(message) {
  if (!message) return null;
  const patterns = [
    /(?:weather|temperature|forecast)\s+(?:in|for|at)\s+(.+?)(?:\?|$)/i,
    /(?:in|for|at)\s+(.+?)(?:\s+weather|\s+temperature|\s+forecast)/i,
    /weather\s+(.+?)(?:\?|$)/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const location = match[1].trim().replace(/[?.!]+$/, '').trim();
      // Ignore day names that might be captured
      if (/^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week|next week)$/i.test(location)) continue;
      if (location.length > 1 && location.length < 100) return location;
    }
  }
  return null;
}

/**
 * Geocode a location name to coordinates using Open-Meteo's free geocoding API.
 * @param {string} name - City or place name
 * @returns {Promise<{lat: number, lon: number, name: string, timezone: string}|null>}
 */
async function geocodeLocation(name) {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    const result = data.results[0];
    return {
      lat: result.latitude,
      lon: result.longitude,
      name: result.name,
      country: result.country,
      timezone: result.timezone,
    };
  } catch {
    return null;
  }
}

/**
 * Derive a human-readable city/region from timezone string.
 * e.g. 'Africa/Johannesburg' → 'Johannesburg, South Africa'
 */
const TIMEZONE_CITIES = {
  'Africa/Johannesburg': 'Johannesburg, South Africa',
  'Africa/Cape_Town': 'Cape Town, South Africa',
  'Africa/Lagos': 'Lagos, Nigeria',
  'Africa/Nairobi': 'Nairobi, Kenya',
  'Africa/Cairo': 'Cairo, Egypt',
  'Europe/London': 'London, United Kingdom',
  'Europe/Paris': 'Paris, France',
  'Europe/Berlin': 'Berlin, Germany',
  'Europe/Madrid': 'Madrid, Spain',
  'Europe/Rome': 'Rome, Italy',
  'Europe/Amsterdam': 'Amsterdam, Netherlands',
  'Europe/Zurich': 'Zurich, Switzerland',
  'Europe/Dublin': 'Dublin, Ireland',
  'Europe/Lisbon': 'Lisbon, Portugal',
  'Europe/Moscow': 'Moscow, Russia',
  'Europe/Istanbul': 'Istanbul, Turkey',
  'America/New_York': 'New York, United States',
  'America/Chicago': 'Chicago, United States',
  'America/Denver': 'Denver, United States',
  'America/Los_Angeles': 'Los Angeles, United States',
  'America/Toronto': 'Toronto, Canada',
  'America/Sao_Paulo': 'São Paulo, Brazil',
  'Asia/Dubai': 'Dubai, UAE',
  'Asia/Shanghai': 'Shanghai, China',
  'Asia/Tokyo': 'Tokyo, Japan',
  'Asia/Singapore': 'Singapore',
  'Asia/Kolkata': 'Delhi, India',
  'Asia/Hong_Kong': 'Hong Kong',
  'Australia/Sydney': 'Sydney, Australia',
  'Australia/Melbourne': 'Melbourne, Australia',
  'Australia/Perth': 'Perth, Australia',
  'Pacific/Auckland': 'Auckland, New Zealand',
};

function getCityFromTimezone(tz) {
  if (!tz) return null;
  if (TIMEZONE_CITIES[tz]) return TIMEZONE_CITIES[tz];
  // Fallback: extract city from timezone string (e.g. 'America/New_York' → 'New York')
  const parts = tz.split('/');
  if (parts.length >= 2) return parts[parts.length - 1].replace(/_/g, ' ');
  return null;
}

module.exports = { getWeatherReport, extractLocationFromMessage, geocodeLocation, getCityFromTimezone };
