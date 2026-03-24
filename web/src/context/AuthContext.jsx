import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken]       = useState(() => localStorage.getItem('token'));
  const [user, setUser]         = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [household, setHousehold] = useState(() => JSON.parse(localStorage.getItem('household') || 'null'));

  const login = useCallback(({ token, user, household }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('household', JSON.stringify(household));
    setToken(token);
    setUser(user);
    setHousehold(household);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('household');
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
