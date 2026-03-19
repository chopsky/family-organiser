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
 * Fetch current weather and today's forecast for given coordinates.
 * @param {number} lat
 * @param {number} lon
 * @param {string} timezone - IANA timezone string
 * @returns {Promise<string>} Formatted weather report
 */
async function getWeatherReport(lat, lon, timezone = 'auto') {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=${encodeURIComponent(timezone)}&forecast_days=3`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo API error: ${res.status}`);
  }

  const data = await res.json();
  const current = data.current;
  const daily = data.daily;

  // Current conditions
  const lines = [
    `🌡️ *Right now:* ${Math.round(current.temperature_2m)}°C (feels like ${Math.round(current.apparent_temperature)}°C)`,
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

    lines.push(`*${dayLabel}:* ${desc} ${lo}°–${hi}°C${rain > 20 ? ` · 🌧️ ${rain}% rain` : ''}`);
  }

  return lines.join('\n');
}

/**
 * Get approximate coordinates from an IANA timezone string.
 * Falls back to London if timezone is unknown.
 */
const TIMEZONE_COORDS = {
  'Africa/Johannesburg': [-26.2, 28.0],
  'Africa/Cape_Town': [-33.9, 18.4],
  'Africa/Lagos': [6.5, 3.4],
  'Africa/Nairobi': [-1.3, 36.8],
  'Africa/Cairo': [30.0, 31.2],
  'Europe/London': [51.5, -0.1],
  'Europe/Paris': [48.9, 2.3],
  'Europe/Berlin': [52.5, 13.4],
  'Europe/Madrid': [40.4, -3.7],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Amsterdam': [52.4, 4.9],
  'Europe/Zurich': [47.4, 8.5],
  'Europe/Dublin': [53.3, -6.3],
  'Europe/Lisbon': [38.7, -9.1],
  'Europe/Moscow': [55.8, 37.6],
  'Europe/Istanbul': [41.0, 29.0],
  'America/New_York': [40.7, -74.0],
  'America/Chicago': [41.9, -87.6],
  'America/Denver': [39.7, -105.0],
  'America/Los_Angeles': [34.1, -118.2],
  'America/Toronto': [43.7, -79.4],
  'America/Sao_Paulo': [-23.5, -46.6],
  'Asia/Dubai': [25.3, 55.3],
  'Asia/Shanghai': [31.2, 121.5],
  'Asia/Tokyo': [35.7, 139.7],
  'Asia/Singapore': [1.4, 103.8],
  'Asia/Kolkata': [28.6, 77.2],
  'Asia/Hong_Kong': [22.3, 114.2],
  'Australia/Sydney': [-33.9, 151.2],
  'Australia/Melbourne': [-37.8, 145.0],
  'Australia/Perth': [-31.9, 115.9],
  'Pacific/Auckland': [-36.9, 174.8],
};

function getCoordsFromTimezone(tz) {
  if (!tz) return null;
  if (TIMEZONE_COORDS[tz]) return TIMEZONE_COORDS[tz];
  // Try partial match (e.g. "Africa/Johannesburg" variants)
  const match = Object.keys(TIMEZONE_COORDS).find(k => k.toLowerCase() === tz.toLowerCase());
  if (match) return TIMEZONE_COORDS[match];
  return null;
}

module.exports = { getWeatherReport, getCoordsFromTimezone };
