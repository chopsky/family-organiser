import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../lib/api';
import { logIn as revenuecatLogIn, logOut as revenuecatLogOut } from '../lib/revenuecat';

const AuthContext = createContext(null);

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Safari private browsing */ }
}
function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch { /* Safari private browsing */ }
}

export function AuthProvider({ children }) {
  const [token, setToken]       = useState(() => safeGetItem('token'));
  const [user, setUser]         = useState(() => JSON.parse(safeGetItem('user') || 'null'));
  const [household, setHousehold] = useState(() => JSON.parse(safeGetItem('household') || 'null'));

  const login = useCallback(({ token, refreshToken, user, household }) => {
    safeSetItem('token', token);
    if (refreshToken) safeSetItem('refreshToken', refreshToken);
    safeSetItem('user', JSON.stringify(user));
    safeSetItem('household', JSON.stringify(household));
    safeSetItem('lastActive', String(Date.now()));
    setToken(token);
    setUser(user);
    setHousehold(household);
  }, []);

  // After the onboarding wizard finishes, the backend flips users.onboarded_at.
  // This helper updates the cached user object (localStorage + state) in-place
  // so the next render sees the new value and stops redirecting to /onboarding.
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...(prev || {}), ...patch };
      safeSetItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    // Revoke the refresh token server-side (fire-and-forget)
    const rt = safeGetItem('refreshToken');
    if (rt) {
      api.post('/auth/logout', { refreshToken: rt }).catch(() => {});
    }
    safeRemoveItem('token');
    safeRemoveItem('refreshToken');
    safeRemoveItem('user');
    safeRemoveItem('household');
    safeRemoveItem('lastActive');
    setToken(null);
    setUser(null);
    setHousehold(null);
    // Clear RevenueCat's identity so the next user on this device
    // doesn't inherit the previous user's subscription state. No-op
    // on web; safe to ignore failures.
    revenuecatLogOut();
  }, []);

  // Keep RevenueCat's app_user_id in sync with the current household.
  // Runs on:
  //   • initial mount when household was restored from localStorage
  //     (already-logged-in user reopens the app),
  //   • every login (household state flips from null → object),
  //   • household switch (rare today, but supported by the model).
  // No-op on web; effective only on native iOS.
  useEffect(() => {
    if (household?.id) {
      revenuecatLogIn(household.id);
    }
  }, [household?.id]);

  // ── Visibility-change idle check ────────────────────────────────
  // When the user returns to the tab after a long absence, fire any
  // authenticated request. If the access token has expired, the axios
  // interceptor will try to refresh. If the refresh token has also
  // expired (> 7 days), the user gets logged out automatically.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      const lastActive = safeGetItem('lastActive');
      const now = Date.now();
      // Only check if the tab was idle for > 24 hours
      if (lastActive && now - Number(lastActive) > 24 * 60 * 60 * 1000) {
        // Trigger any authenticated call — the 401 interceptor handles the rest
        api.get('/auth/me').catch(() => {});
      }
      safeSetItem('lastActive', String(now));
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    // Set initial timestamp
    safeSetItem('lastActive', String(Date.now()));
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return (
    <AuthContext.Provider value={{
      token, user, household, login, logout, updateUser,
      isAdmin: user?.role === 'admin',
      isPlatformAdmin: user?.isPlatformAdmin === true,
      needsHousehold: !!token && !household,
      needsOnboarding: !!token && !!household && user && !user.onboarded_at,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
