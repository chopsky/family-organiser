import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from './AuthContext';

// Child Mode is a per-DEVICE, client-side flag (same household login). It locks
// the device to a kid-safe surface; an adult exits / opens Settings with a PIN
// that lives on the household (synced). This is a soft UI guardrail, not a
// server-side access boundary.
const ChildModeContext = createContext(null);

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Safari private browsing */ }
}
function safeRemoveItem(key) {
  try { localStorage.removeItem(key); } catch { /* Safari private browsing */ }
}

export function ChildModeProvider({ children }) {
  const { household } = useAuth();
  const pinIsSet = !!household?.child_mode_pin_set;

  // Persisted per-device. settingsUnlocked is transient (a reload re-locks).
  const [enabled, setEnabled] = useState(() => safeGetItem('childMode') === '1');
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);

  const location = useLocation();
  // Re-lock Settings the moment we navigate away from it, so it's never left
  // permanently open behind the gate.
  useEffect(() => {
    if (settingsUnlocked && location.pathname !== '/settings') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettingsUnlocked(false);
    }
  }, [location.pathname, settingsUnlocked]);

  // Reset Child Mode whenever the auth identity changes - a fresh login, a
  // logout, or a household switch. Re-authenticating is an adult action, so the
  // device must come back in ADULT mode and never inherit the previous session's
  // lock. We skip the FIRST run so a plain reload with the same restored session
  // keeps Child Mode on (a child reopening the app stays locked). Without this,
  // the per-device flag survived logout/login and re-locked the next sign-in.
  const hhRef = useRef(undefined);
  const mountedRef = useRef(false);
  useEffect(() => {
    const id = household?.id || null;
    if (!mountedRef.current) {
      mountedRef.current = true;
      hhRef.current = id;
      return;
    }
    if (id !== hhRef.current) {
      hhRef.current = id;
      safeRemoveItem('childMode');
      setEnabled(false);
      setSettingsUnlocked(false);
    }
  }, [household?.id]);

  // Enabling requires a PIN to exist (otherwise the device could be locked with
  // no way back in).
  const enable = useCallback(() => {
    if (!pinIsSet) return false;
    safeSetItem('childMode', '1');
    setEnabled(true);
    return true;
  }, [pinIsSet]);

  const disable = useCallback(() => {
    safeRemoveItem('childMode');
    setEnabled(false);
    setSettingsUnlocked(false);
  }, []);

  const unlockSettings = useCallback(() => setSettingsUnlocked(true), []);
  const lockSettings = useCallback(() => setSettingsUnlocked(false), []);

  const verifyPin = useCallback(async (pin) => {
    try {
      const { data } = await api.post('/household/child-mode/verify-pin', { pin });
      if (data?.ok) { setSettingsUnlocked(true); return true; }
      return false;
    } catch {
      return false;
    }
  }, []);

  return (
    <ChildModeContext.Provider value={{
      enabled, settingsUnlocked, pinIsSet,
      enable, disable, unlockSettings, lockSettings, verifyPin,
    }}>
      {children}
    </ChildModeContext.Provider>
  );
}

export function useChildMode() {
  return useContext(ChildModeContext);
}
