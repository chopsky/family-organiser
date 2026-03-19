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

module.exports = { getWeatherReport };
