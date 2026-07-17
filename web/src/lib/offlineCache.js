/**
 * Offline read cache - iOS-only.
 *
 * Persists the last successful response for each cache key into
 * localStorage so the app can render last-known data when the
 * device is offline (e.g. on the train, in a basement, after the
 * Capacitor WebView starts before the network is up).
 *
 * Scope is deliberately narrow:
 *   • Read-only - mutations still fail when offline. We don't queue
 *     writes; that's a much bigger feature with its own conflict
 *     story.
 *   • No-op on the web - `isNative()` short-circuits every call so
 *     the web bundle behaves exactly as before.
 *
 * Keys are caller-defined strings. Use stable keys that include any
 * variant axis (e.g. `tasks` for the global tasks view, `meals:week-2026-05-11`
 * if the same key would render different content per week).
 */

import { isNative } from './platform';

const PREFIX = 'cache:v1:';

/**
 * Read the cached entry for a key. Returns null when the cache is
 * empty, corrupt, or the platform is non-native (web).
 *
 * Shape: { data, ts } where ts is the epoch ms at which the entry
 * was written. Callers can use ts to render a "last updated" hint.
 */
export function readCache(key) {
  if (!isNative()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Persist a cache entry. Silent on quota/serialisation failure -
 * cache misses are recoverable, throwing here would break the
 * network fetch path for no benefit.
 */
export function writeCache(key, data) {
  if (!isNative()) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // Quota exceeded, JSON cycle, etc - ignore.
  }
}

/**
 * Helper for the common "show cache instantly, then refresh from
 * network" pattern. Calls `setData` synchronously with cached
 * payload (if any), then awaits `fetcher` and re-calls `setData`
 * with fresh payload + writes it back to the cache.
 *
 * If the network fetch fails AND there was no cached fallback,
 * the error propagates so the caller can render its existing
 * error state. If there WAS a cached fallback, the error is
 * swallowed - we already showed the user something useful.
 *
 * Returns the value finally rendered (fresh on success, cached
 * on network failure with cache hit).
 */
export async function loadCached(key, fetcher, setData) {
  const cached = readCache(key);
  if (cached) setData(cached.data);
  try {
    const fresh = await fetcher();
    writeCache(key, fresh);
    setData(fresh);
    return fresh;
  } catch (err) {
    if (cached) return cached.data;
    throw err;
  }
}

/**
 * Drop a single cache entry. Used by the members-changed listener
 * below; exported for any future targeted invalidation.
 */
export function removeCache(key) {
  if (!isNative()) return;
  try { localStorage.removeItem(PREFIX + key); } catch { /* best-effort */ }
}

// Member mutations must not leave member-derived pages painting stale
// rosters from this cache. FamilySetup dispatches
// 'housemait:members-changed' after add/remove; drop every key whose
// payload embeds the member list so the next page mount paints fresh
// (observed: a removed child lingering on the School page for a minute
// when the background refresh was slow - stale-while-revalidate kept
// the old paint and swallowed the error because a cache entry existed).
if (typeof window !== 'undefined') {
  window.addEventListener('housemait:members-changed', () => {
    removeCache('household:members');
    removeCache('schools');
    removeCache('household:activities');
  });
}

/**
 * Clear all v1 cache entries. Useful on logout so the next user
 * doesn't see the previous user's data flash before their own
 * loads.
 */
export function clearAllCache() {
  if (!isNative()) return;
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch {
    // Best-effort cleanup.
  }
}
