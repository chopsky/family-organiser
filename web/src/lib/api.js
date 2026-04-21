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

// ── Token refresh state ──────────────────────────────────────────
// When a 401 arrives, attempt a silent refresh using the stored
// refresh token. Multiple concurrent 401s share a single refresh
// call — failed requests queue up and replay once the refresh lands.
let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token);
    }
  });
  failedQueue = [];
}

function forceLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('household');
  localStorage.removeItem('lastActive');
  window.location.href = '/';
}

// Auto-refresh on 401, retry with exponential backoff on 429
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

    const originalRequest = err.config;

    // ── Handle 401: attempt silent token refresh ──
    if (err.response?.status === 401 && !originalRequest._retry) {
      // Public auth endpoints return 401 on bad credentials — that's
      // semantic ("wrong password"), not a session-expiry signal. Don't
      // force-logout or silently refresh; let the caller's catch block
      // surface the real error. Before this guard, a bad-password login
      // attempt triggered forceLogout → window.location='/' and the user
      // saw the landing page with no visible error.
      if (originalRequest.url?.match(/\/auth\/(login|register|forgot-password|reset-password|resend-verification|verify-email)/)) {
        return Promise.reject(err);
      }

      // If this IS the refresh call itself failing, force logout
      if (originalRequest.url?.includes('/auth/refresh')) {
        forceLogout();
        return Promise.reject(err);
      }

      if (isRefreshing) {
        // Another refresh is already in-flight — queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        isRefreshing = false;
        forceLogout();
        return Promise.reject(err);
      }

      try {
        // Use raw axios (not our `api` instance) to avoid interceptor loops
        const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken });

        // Store new tokens
        localStorage.setItem('token', data.token);
        localStorage.setItem('refreshToken', data.refreshToken);
        if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
        if (data.household) localStorage.setItem('household', JSON.stringify(data.household));

        // Replay all queued requests with the new token
        processQueue(null, data.token);

        // Retry the original request
        originalRequest.headers.Authorization = `Bearer ${data.token}`;
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        forceLogout();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
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
