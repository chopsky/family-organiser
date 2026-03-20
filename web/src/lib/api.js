import axios from 'axios';

// In production, set VITE_API_URL to the Railway backend URL (e.g. https://my-app.railway.app).
// In development, the Vite proxy handles /api → localhost:3000, so leave VITE_API_URL unset.
const BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

const api = axios.create({ baseURL: BASE });

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401, retry on 429 (rate limit)
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('household');
      window.location.href = '/login';
    }
    // Retry once on rate limit after a brief pause
    if (err.response?.status === 429 && !err.config._retried) {
      err.config._retried = true;
      await new Promise(r => setTimeout(r, 1000));
      return api(err.config);
    }
    return Promise.reject(err);
  }
);

export default api;
