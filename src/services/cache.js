/**
 * Simple in-memory cache with TTL expiry.
 *
 * Keys are typically scoped by household ID, e.g. `members:${householdId}`.
 * No external dependencies — just a Map with timestamps.
 */

const store = new Map();

/**
 * Get a cached value if it exists and has not expired.
 * @param {string} key
 * @returns {*} The cached value, or null if missing/expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }

  return entry.value;
}

/**
 * Store a value with a TTL.
 * @param {string} key
 * @param {*} value
 * @param {number} ttlSeconds — time-to-live in seconds
 */
function set(key, value, ttlSeconds) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Remove a specific key from the cache.
 * @param {string} key
 */
function invalidate(key) {
  store.delete(key);
}

/**
 * Remove all keys whose name includes the given pattern string.
 * Useful for clearing everything related to a household, e.g.
 *   invalidatePattern(householdId)
 * will clear `members:<id>`, `digest:<id>`, `schools:<id>`, etc.
 *
 * @param {string} pattern — substring to match against cache keys
 */
function invalidatePattern(pattern) {
  for (const key of store.keys()) {
    if (key.includes(pattern)) {
      store.delete(key);
    }
  }
}

/**
 * Return the current number of entries (for diagnostics).
 */
function size() {
  return store.size;
}

/**
 * Clear the entire cache.
 */
function clear() {
  store.clear();
}

module.exports = { get, set, invalidate, invalidatePattern, size, clear };
