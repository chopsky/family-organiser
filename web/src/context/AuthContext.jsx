import { createContext, useContext, useState, useCallback } from 'react';

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

  const login = useCallback(({ token, user, household }) => {
    safeSetItem('token', token);
    safeSetItem('user', JSON.stringify(user));
    safeSetItem('household', JSON.stringify(household));
    setToken(token);
    setUser(user);
    setHousehold(household);
  }, []);

  const logout = useCallback(() => {
    safeRemoveItem('token');
    safeRemoveItem('user');
    safeRemoveItem('household');
    setToken(null);
    setUser(null);
    setHousehold(null);
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, household, login, logout, isAdmin: user?.role === 'admin', isPlatformAdmin: user?.isPlatformAdmin === true, needsHousehold: !!token && !household }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
