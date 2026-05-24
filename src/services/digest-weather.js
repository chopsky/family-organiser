/**
 * Fetch today's weather for a household, ready to feed into
 * buildDigestWeatherLine() for the morning WhatsApp digest.
 *
 * Location source is *only* household.address (geocoded via Photon
 * - OSM, no API key). Timezone is NOT used as a fallback because
 * tz-derived cities are too vague - a Bristol family would see
 * London weather, a Cape Town family would see Joburg weather, and
 * the digest stops being trustworthy. Better to omit the line
 * entirely and let the user notice they should set an address.
 *
 * Provider chain: Open-Meteo (primary, more accurate, daily-shape API)
 * → wttr.in (fallback, different infrastructure - WWO-backed). Both
 * are free and key-less; the fallback exists because Open-Meteo has
 * recurring 502 windows that took out the morning digest twice in a
 * row, and three quick retries don't help when the upstream is
 * genuinely down. wttr.in lives on completely separate infra so it
 * shouldn't share an outage with Open-Meteo.
 *
 * Cache: 12h in-memory per household. Negative cache 30 min so a
 * recovered upstream is picked up by the next admin re-trigger.
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
      console.warn(`[digest-weather] Photon returned no match for "${query}" - try a simpler / more standard address`);
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
    console.log(`[digest-weather] household ${household?.id} has no address - skipping weather`);
    return null;
  }
  return geocodeViaPhoton(household.address.trim());
}

/**
 * Map a WWO weather code (wttr.in / worldweatheronline) to the
 * Open-Meteo WMO daily code that buildDigestWeatherLine() knows how
 * to dispatch on. Coarse buckets - exact mapping is overkill because
 * weather-line.js mostly cares about clear / cloud / rain / snow /
 * thunder / fog and falls through to a generic "${hi}°C in ${city}"
 * line for anything unrecognised. Reference:
 *   https://www.worldweatheronline.com/developer/api/docs/weather-icons.aspx
 */
function wwoToWmo(wwo) {
  if (wwo === 113) return 0; // clear / sunny
  if (wwo === 116) return 2; // partly cloudy
  if (wwo === 119 || wwo === 122) return 3; // cloudy / overcast
  if (wwo === 143 || wwo === 248) return 45; // mist / fog
  if (wwo === 260) return 48; // freezing fog
  if (wwo === 200 || wwo === 386 || wwo === 389) return 95; // thunder
  if (wwo === 392 || wwo === 395) return 96; // snowy thunder
  if ([176, 263, 266, 281, 293, 296, 311].includes(wwo)) return 61; // light rain / drizzle
  if ([284, 299, 302, 314].includes(wwo)) return 63; // moderate rain
  if ([305, 308].includes(wwo)) return 65; // heavy rain
  if (wwo === 353) return 80; // light showers
  if (wwo === 356) return 81; // moderate showers
  if (wwo === 359) return 82; // heavy showers
  if ([179, 182, 185, 317, 320, 323, 326, 329, 332, 362, 365].includes(wwo)) return 71; // snow light/mod
  if ([335, 338, 350, 374, 377].includes(wwo)) return 75; // heavy snow / ice
  if ([368, 371].includes(wwo)) return 85; // snow showers
  return undefined; // unknown → weather-line falls through to generic
}

async function fetchFromOpenMeteo(loc, tz) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}` +
    `&longitude=${loc.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=${encodeURIComponent(tz)}` +
    `&forecast_days=1`;

  // Retry on 5xx (occasional 502/503 blips). 4xx is treated as a hard
  // fail - usually a bad lat/lon. Three attempts with 250ms / 750ms
  // backoff catches the common transient case without making the
  // digest job sluggish. After 3 strikes, throw and let the caller
  // try wttr.in.
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 250 : 750));
    }
    try {
      res = await fetch(url);
      if (res.ok) break;
      lastErr = new Error(`Open-Meteo ${res.status}`);
      if (res.status < 500) break; // 4xx - don't retry
    } catch (e) {
      lastErr = e;
    }
  }
  if (!res?.ok) throw lastErr || new Error('Open-Meteo unknown failure');

  const data = await res.json();
  const d = data.daily;
  if (!d || !Array.isArray(d.time) || d.time.length === 0) {
    throw new Error('Open-Meteo returned no daily data');
  }
  return {
    cityName: loc.cityName || 'home',
    code: Number(d.weather_code?.[0]),
    hi: Math.round(d.temperature_2m_max?.[0]),
    lo: Math.round(d.temperature_2m_min?.[0]),
    precipProbability: d.precipitation_probability_max?.[0] ?? 0,
  };
}

async function fetchFromWttr(loc) {
  // wttr.in accepts "lat,lon" and returns a JSON forecast block.
  // No API key, no rate limit we've ever hit, completely separate
  // infrastructure from Open-Meteo. Good as a "different upstream"
  // fallback when Open-Meteo is having a 502 day.
  const url = `https://wttr.in/${loc.lat},${loc.lon}?format=j1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Housemait-Digest/1.0 (+https://housemait.com)' },
  });
  if (!res.ok) throw new Error(`wttr.in ${res.status}`);
  const data = await res.json();
  const today = data?.weather?.[0];
  if (!today) throw new Error('wttr.in returned no weather array');

  // chanceofrain lives on the hourly entries (8 per day, 3h apart).
  // Take the max so the "wet day" branch in weather-line.js fires
  // appropriately even when only one window is rainy.
  const hourly = Array.isArray(today.hourly) ? today.hourly : [];
  const maxChance = hourly.reduce((acc, h) => {
    const n = Number(h?.chanceofrain);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);

  // weatherCode is on each hourly entry. The midday entry (index 4 =
  // 12:00) is the most representative of "today's headline" for a
  // morning digest.
  const middayCode = Number(hourly[4]?.weatherCode ?? hourly[0]?.weatherCode);

  return {
    cityName: loc.cityName || 'home',
    code: wwoToWmo(middayCode),
    hi: Math.round(Number(today.maxtempC)),
    lo: Math.round(Number(today.mintempC)),
    precipProbability: maxChance,
  };
}

/**
 * Fetch today's forecast for a household. Cached for 12h. Tries
 * Open-Meteo first, falls back to wttr.in if Open-Meteo throws.
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

  const tz = household.timezone || 'auto';
  let forecast = null;
  let openMeteoErr = null;
  try {
    forecast = await fetchFromOpenMeteo(loc, tz);
  } catch (err) {
    openMeteoErr = err;
    console.warn(`[digest-weather] Open-Meteo failed for household ${household.id}: ${err.message} - trying wttr.in fallback`);
    try {
      forecast = await fetchFromWttr(loc);
      console.log(`[digest-weather] wttr.in fallback succeeded for household ${household.id}`);
    } catch (wttrErr) {
      console.warn(`[digest-weather] wttr.in fallback ALSO failed for household ${household.id}: ${wttrErr.message} - giving up`);
    }
  }

  if (forecast) {
    cache.set(household.id, { data: forecast, ts: Date.now() });
    return forecast;
  }
  // Both providers down. Negative-cache so subsequent member
  // iterations in the same digest run don't beat up the upstream.
  cache.set(household.id, { data: null, ts: Date.now() });
  return null;
}

function invalidateHouseholdWeatherCache(householdId) {
  if (householdId) cache.delete(householdId);
}

module.exports = { fetchTodayForecastForHousehold, invalidateHouseholdWeatherCache };
