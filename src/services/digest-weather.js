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
 * → MET Norway / api.met.no (a national meteorological service, very
 * reliable, key-less, genuinely independent infra) → wttr.in (last
 * resort, WWO-backed hobby service). All three are free and key-less.
 * The chain grew to three because Open-Meteo 503'd AND wttr.in
 * connection-failed together at 07:00 two mornings running, taking out
 * the Schneiders' brief entirely - two flaky free providers can share a
 * bad moment, so a solid third (met.no) is the real insurance. met.no
 * requires an identifying User-Agent (it 403s generic ones).
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

// Every upstream weather/geocode call gets a hard timeout. A hung provider
// (wttr.in stalled ~90s at 07:00 with no AbortController, killing the brief
// AND holding up the sequential per-household loop behind it) must fail fast
// so the next provider in the chain gets its turn well inside the digest
// window. On timeout, fetch() rejects with an AbortError the caller catches.
async function fetchWithTimeout(url, { timeoutMs = 8000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeViaPhoton(query) {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetchWithTimeout(url);
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

// Reverse of geocodeViaPhoton: coords → a city label for the digest line.
async function reverseGeocodeViaPhoton(lat, lon) {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const props = data.features?.[0]?.properties || {};
    return { cityName: props.city || props.town || props.village || props.county || props.name || null };
  } catch {
    return null;
  }
}

// A shared device location has to be FRESH to outrank the typed home address:
// otherwise last week's holiday would keep showing after you're back. 48h.
const FRESH_LOCATION_MS = 48 * 60 * 60 * 1000;

/**
 * Pick the best household member's shared device location. Returns the most
 * recently-updated coord with a `fresh` flag (updated within FRESH_LOCATION_MS),
 * or null when no member has coords. Pure + exported so the precedence is unit-
 * testable without hitting the network. A missing/blank timestamp is treated as
 * stale (fresh:false) - it still qualifies as a last-resort location.
 */
function pickMemberLocation(members, nowMs = Date.now()) {
  const coords = (members || [])
    .filter((m) => Number.isFinite(m?.latitude) && Number.isFinite(m?.longitude))
    .map((m) => {
      const t = m.location_updated_at ? Date.parse(m.location_updated_at) : 0;
      return { lat: m.latitude, lon: m.longitude, ts: Number.isNaN(t) ? 0 : t };
    });
  if (!coords.length) return null;
  coords.sort((a, b) => b.ts - a.ts);
  const best = coords[0];
  return { lat: best.lat, lon: best.lon, fresh: !!best.ts && (nowMs - best.ts) <= FRESH_LOCATION_MS };
}

/**
 * The household's previously-geocoded address coords, IF the cached address
 * still matches the current one. Pure + exported: lets the brief reuse a good
 * geocode instead of hitting Photon every morning (a Photon blip at 07:00 was
 * silently dropping weather for the whole day). Returns null when nothing is
 * cached, or when the address has since changed (→ re-geocode).
 */
function cachedHouseholdGeocode(household) {
  const address = household?.address?.trim();
  if (!address) return null;
  if ((household.geo_address || '').trim() !== address) return null;
  if (!Number.isFinite(household.geo_latitude) || !Number.isFinite(household.geo_longitude)) return null;
  return { lat: household.geo_latitude, lon: household.geo_longitude, cityName: household.geo_city || null };
}

/**
 * Location precedence for the morning brief:
 *   1. A FRESH shared device location (a member opened the app <=48h ago) -
 *      the "match the app" path.
 *   2. The typed home address (Family → Household): a cached geocode if the
 *      address is unchanged (no Photon call), else geocode fresh + cache it.
 *   3. A STALE shared location - better than nothing when there's no address.
 *   4. null - omit weather. Deliberately NO timezone guess (that gives
 *      confidently-wrong, wrong-city weather).
 */
async function resolveLocation(household, members = []) {
  const pick = pickMemberLocation(members);

  if (pick && pick.fresh) {
    const rev = await reverseGeocodeViaPhoton(pick.lat, pick.lon);
    return { lat: pick.lat, lon: pick.lon, cityName: rev?.cityName || null };
  }

  const address = household?.address?.trim();
  if (address) {
    const cached = cachedHouseholdGeocode(household);
    if (cached) return cached;
    const geo = await geocodeViaPhoton(address);
    if (geo) {
      // Cache so tomorrow's brief skips Photon. Fire-and-forget - never
      // blocks the digest, and a write failure just means we geocode again.
      require('../db/queries')
        .updateHouseholdGeocode(household.id, { lat: geo.lat, lon: geo.lon, city: geo.cityName, address })
        .catch((e) => console.warn('[digest-weather] geocode cache write failed:', e.message));
      return geo;
    }
  }

  if (pick) {
    const rev = await reverseGeocodeViaPhoton(pick.lat, pick.lon);
    return { lat: pick.lat, lon: pick.lon, cityName: rev?.cityName || null };
  }

  console.log(`[digest-weather] household ${household?.id} has no shared location or address - skipping weather`);
  return null;
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
  // fail - usually a bad lat/lon. Three attempts with 400ms / 1200ms
  // backoff catches the common transient case; each attempt is itself
  // time-boxed so a slow-failing edge can't burn the whole window. After
  // 3 strikes, throw and let the caller try met.no.
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 400 : 1200));
    }
    try {
      res = await fetchWithTimeout(url, { timeoutMs: 7000 });
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

/**
 * Map a MET Norway symbol_code ("cloudy", "lightrainshowers_day",
 * "heavysnowandthunder") to the WMO daily code buildDigestWeatherLine()
 * dispatches on. The _day/_night/_polartwilight suffix is irrelevant to the
 * digest so it's stripped first. Coarse buckets, same philosophy as wwoToWmo.
 * Reference: https://api.met.no/weatherapi/weathericon/2.0/documentation
 */
function metnoToWmo(symbolCode) {
  if (!symbolCode) return undefined;
  const s = String(symbolCode).replace(/_(day|night|polartwilight)$/, '');
  if (s === 'clearsky') return 0;
  if (s === 'fair') return 1;
  if (s === 'partlycloudy') return 2;
  if (s === 'cloudy') return 3;
  if (s === 'fog') return 45;
  if (s.includes('thunder')) return 95;                       // any *andthunder variant
  if (s.includes('sleet')) return 66;                         // sleet / freezing rain
  if (s.includes('snow')) return s.startsWith('heavy') ? 75 : 71;
  if (s.includes('rain')) {
    if (s.startsWith('heavy')) return 65;
    if (s.startsWith('light')) return 61;
    return 63;                                                // moderate rain / showers
  }
  return undefined;                                           // unknown → generic line
}

/**
 * Reduce a met.no /compact timeseries + the household tz to today's headline:
 * hi/lo across today's hourly instant temps, a midday-representative weather
 * code, and a rough precip probability from the forecast precipitation
 * amounts (compact carries amount, not probability). Pure + exported so the
 * mapping is unit-testable without the network. "Today" is the local calendar
 * date of `nowMs` in `tz`; a morning brief only sees the rest of today's
 * hours, which is fine - the daytime high is what matters for the digest.
 */
function summariseMetnoToday(timeseries, tz, nowMs = Date.now()) {
  const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false });
  const todayStr = dateFmt.format(new Date(nowMs));

  const rows = (Array.isArray(timeseries) ? timeseries : [])
    .map((t) => {
      const d = new Date(t.time);
      return { t, date: dateFmt.format(d), hour: parseInt(hourFmt.format(d), 10) };
    })
    .filter((r) => r.date === todayStr);
  if (!rows.length) return null;

  let hi = -Infinity, lo = Infinity, maxPrecip = 0;
  for (const { t } of rows) {
    const temp = Number(t?.data?.instant?.details?.air_temperature);
    if (Number.isFinite(temp)) { if (temp > hi) hi = temp; if (temp < lo) lo = temp; }
    const amt = Number(
      t?.data?.next_1_hours?.details?.precipitation_amount
      ?? t?.data?.next_6_hours?.details?.precipitation_amount,
    );
    if (Number.isFinite(amt) && amt > maxPrecip) maxPrecip = amt;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;

  // Representative symbol: the entry closest to local noon that carries one.
  const withSym = rows
    .map((r) => ({ hour: r.hour, sym: r.t?.data?.next_1_hours?.summary?.symbol_code || r.t?.data?.next_6_hours?.summary?.symbol_code }))
    .filter((r) => r.sym)
    .sort((a, b) => Math.abs(a.hour - 12) - Math.abs(b.hour - 12));

  // Compact gives amount, not probability. Coarse-map to a % the wet-day
  // branch in weather-line.js can read; the code bucket already conveys rain.
  const precipProbability = maxPrecip >= 2 ? 80 : maxPrecip >= 0.5 ? 60 : maxPrecip > 0 ? 40 : 0;

  return { hi: Math.round(hi), lo: Math.round(lo), code: metnoToWmo(withSym[0]?.sym), precipProbability };
}

async function fetchFromMetNo(loc, tz) {
  // MET Norway REQUIRES an identifying User-Agent with contact info, else 403.
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${loc.lat}&lon=${loc.lon}`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 8000,
    headers: { 'User-Agent': 'Housemait/1.0 https://housemait.com support@housemait.com' },
  });
  if (!res.ok) throw new Error(`met.no ${res.status}`);
  const data = await res.json();
  const today = summariseMetnoToday(data?.properties?.timeseries, tz);
  if (!today) throw new Error('met.no returned no usable today data');
  return { cityName: loc.cityName || 'home', ...today };
}

async function fetchFromWttr(loc) {
  // wttr.in accepts "lat,lon" and returns a JSON forecast block.
  // No API key, no rate limit we've ever hit, completely separate
  // infrastructure from Open-Meteo. Good as a "different upstream"
  // fallback when Open-Meteo is having a 502 day.
  const url = `https://wttr.in/${loc.lat},${loc.lon}?format=j1`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 8000,
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
async function fetchTodayForecastForHousehold(household, members = []) {
  if (!household?.id) return null;

  const cached = cache.get(household.id);
  if (cached) {
    const ttl = cached.data ? CACHE_TTL_MS : NEG_CACHE_TTL_MS;
    if (Date.now() - cached.ts < ttl) return cached.data;
  }

  const loc = await resolveLocation(household, members);
  if (!loc) {
    cache.set(household.id, { data: null, ts: Date.now() });
    return null;
  }

  const tz = household.timezone || 'auto';
  // Three independent providers, tried in order. Open-Meteo 503'd AND wttr.in
  // connection-failed together at 07:00 two mornings running, so met.no (a
  // national met service on separate infra) sits between them. Each attempt is
  // logged with status + latency so the next incident is diagnosable at a
  // glance (429 rate-limit vs 503 outage vs an AbortError timeout).
  const providers = [
    { name: 'Open-Meteo', run: () => fetchFromOpenMeteo(loc, tz) },
    { name: 'met.no',     run: () => fetchFromMetNo(loc, tz) },
    { name: 'wttr.in',    run: () => fetchFromWttr(loc) },
  ];
  let forecast = null;
  for (const p of providers) {
    const t0 = Date.now();
    try {
      forecast = await p.run();
      console.log(`[digest-weather] ${p.name} ok for household ${household.id} (${Date.now() - t0}ms)`);
      break;
    } catch (err) {
      console.warn(`[digest-weather] ${p.name} failed for household ${household.id} (${Date.now() - t0}ms): ${err.message}`);
    }
  }

  if (forecast) {
    cache.set(household.id, { data: forecast, ts: Date.now() });
    return forecast;
  }
  // All providers down. Negative-cache (30 min) so subsequent member
  // iterations in the same digest run don't beat up the upstreams, but a
  // recovered provider is picked up soon after.
  console.warn(`[digest-weather] ALL weather providers failed for household ${household.id} - no weather line today`);
  cache.set(household.id, { data: null, ts: Date.now() });
  return null;
}

function invalidateHouseholdWeatherCache(householdId) {
  if (householdId) cache.delete(householdId);
}

module.exports = { fetchTodayForecastForHousehold, invalidateHouseholdWeatherCache, pickMemberLocation, cachedHouseholdGeocode, metnoToWmo, summariseMetnoToday };
