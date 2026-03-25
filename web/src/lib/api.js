import axios from 'axios';

// In production, set VITE_API_URL to the Railway backend URL (e.g. https://my-app.railway.app).
// In development, the Vite proxy handles /api → localhost:3000, so leave VITE_API_URL unset.
const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

const api = axios.create({ baseURL: BASE });

// ── Request deduplication ────────────────────────────────────────
// If an identical GET request is already in flight, reuse its promise
// instead of firing a duplicate.
const inflightGets = new Map();

function getDedupeKey(config) {
  if (config.method !== 'get') return null;
  const params = config.params ? JSON.stringify(config.params) : '';
  return `${config.baseURL || ''}${config.url}?${params}`;
}

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401, retry with exponential backoff on 429
api.interceptors.response.use(
  (res) => {
    // Clear inflight entry on success
    const key = getDedupeKey(res.config);
    if (key) inflightGets.delete(key);
    return res;
  },
  async (err) => {
    const key = getDedupeKey(err.config);
    if (key) inflightGets.delete(key);

    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('household');
      window.location.href = '/login';
    }
    // Retry up to 3 times on rate limit with exponential backoff
    const retryCount = err.config._retryCount || 0;
    if (err.response?.status === 429 && retryCount < 3) {
      err.config._retryCount = retryCount + 1;
      const delay = Math.min(1000 * Math.pow(2, retryCount), 8000); // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay));
      return api(err.config);
    }
    return Promise.reject(err);
  }
);

// Wrap api.get to deduplicate identical in-flight GET requests
const originalGet = api.get.bind(api);
api.get = function deduplicatedGet(url, config) {
  const fullConfig = { ...config, url, method: 'get', baseURL: api.defaults.baseURL };
  const key = getDedupeKey(fullConfig);
  if (key && inflightGets.has(key)) {
    return inflightGets.get(key);
  }
  const promise = originalGet(url, config).finally(() => {
    if (key) inflightGets.delete(key);
  });
  if (key) inflightGets.set(key, promise);
  return promise;
};

export default api;
