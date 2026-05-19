/**
 * Fetch today's weather for a household, ready to feed into
 * buildDigestWeatherLine() for the morning WhatsApp digest.
 *
 * Location source is *only* household.address (geocoded via Photon
 * — OSM, no API key). Timezone is NOT used as a fallback because
 * tz-derived cities are too vague — a Bristol family would see
 * London weather, a Cape Town family would see Joburg weather, and
 * the digest stops being trustworthy. Better to omit the line
 * entirely and let the user notice they should set an address.
 *
 * Cache: 12h in-memory per household. Open-Meteo + Photon are both
 * free and fast, but we still don't want to re-fetch on every cron
 * heartbeat or admin trigger.
 */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours for successful fetches
// Negative cache is much shorter so a transient Photon / Open-Meteo
// hiccup at digest time doesn't silently kill weather for the rest of
// the day. A retry an hour later (e.g. admin manually re-firing
// /reminders) gets a fresh shot. 12h on a null was poisoning the
// next digest in cases where the API recovered minutes after the miss.
const NEG_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for null/failure
const cache = new Map(); // key: householdId → { data, ts }

async function geocodeViaPhoton(query) {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[digest-weather] Photon HTTP ${res.status} for "${query}"`);
      return null;
    }
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) {
      console.warn(`[digest-weather] Photon returned no match for "${query}" — try a simpler / more standard address`);
      return null;
    }
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties || {};
    // Best human label for the line: city/town/village, falling back to name.
    const cityName = props.city || props.town || props.village || props.county || props.name || null;
    return { lat, lon, cityName };
  } catch (err) {
    console.warn(`[digest-weather] Photon fetch threw for "${query}":`, err.message);
    return null;
  }
}

async function resolveLocation(household) {
  if (!household?.address?.trim()) {
    console.log(`[digest-weather] household ${household?.id} has no address — skipping weather`);
    return null;
  }
  return geocodeViaPhoton(household.address.trim());
}

/**
 * Fetch today's forecast for a household. Cached for 12h.
 *
 * @param {object} household - { id, address, timezone }
 * @returns {Promise<object|null>} shape suitable for buildDigestWeatherLine:
 *   { cityName, code, hi, lo, precipProbability }
 */
async function fetchTodayForecastForHousehold(household) {
  if (!household?.id) return null;

  const cached = cache.get(household.id);
  if (cached) {
    const ttl = cached.data ? CACHE_TTL_MS : NEG_CACHE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.data;
  }

  const loc = await resolveLocation(household);
  if (!loc) {
    cache.set(household.id, { data: null, ts: Date.now() });
    return null;
  }

  try {
    const tz = household.timezone || 'auto';
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}` +
      `&longitude=${loc.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=${encodeURIComponent(tz)}` +
      `&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    const data = await res.json();
    const d = data.daily;
    if (!d || !Array.isArray(d.time) || d.time.length === 0) {
      console.warn(`[digest-weather] Open-Meteo returned no daily data for household ${household.id} (lat=${loc.lat}, lon=${loc.lon})`);
      return null;
    }
    const forecast = {
      cityName: loc.cityName || 'home',
      code: Number(d.weather_code?.[0]),
      hi: Math.round(d.temperature_2m_max?.[0]),
      lo: Math.round(d.temperature_2m_min?.[0]),
      precipProbability: d.precipitation_probability_max?.[0] ?? 0,
    };
    cache.set(household.id, { data: forecast, ts: Date.now() });
    return forecast;
  } catch (err) {
    console.warn(`[digest-weather] forecast fetch failed for household ${household.id}:`, err.message);
    return null;
  }
}

module.exports = { fetchTodayForecastForHousehold };
