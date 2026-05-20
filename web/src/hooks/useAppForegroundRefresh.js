/**
 * useAppForegroundRefresh - fire a callback whenever the app/tab
 * returns to the foreground.
 *
 * Native apps always feel current because they re-fetch on foreground;
 * web apps don't, because there's no equivalent lifecycle event.
 *   • iOS native: Capacitor's App.addListener('appStateChange', …)
 *   • Web:        document visibilitychange + window pageshow
 *
 * Usage:
 *
 *   useAppForegroundRefresh(() => {
 *     loadDashboard();
 *   });
 *
 * Mount near the top of any page that should "feel fresh" after the
 * user comes back to it.
 *
 * Throttled to once every 30s by default so a quick app-switch doesn't
 * fire a volley of refreshes. Pass throttleMs=0 to disable when the
 * refresh is genuinely cheap and you want every resume to retry.
 */

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

const DEFAULT_THROTTLE_MS = 30 * 1000;

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function useAppForegroundRefresh(onForeground, { throttleMs = DEFAULT_THROTTLE_MS } = {}) {
  const lastFiredRef = useRef(0);
  const callbackRef = useRef(onForeground);

  // Keep the latest callback in a ref so the listener doesn't have
  // to re-subscribe on every render.
  useEffect(() => { callbackRef.current = onForeground; }, [onForeground]);

  useEffect(() => {
    let cancelled = false;
    function fire() {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastFiredRef.current < throttleMs) return;
      lastFiredRef.current = now;
      try {
        callbackRef.current?.();
      } catch (err) {
        console.warn('[useAppForegroundRefresh] callback threw:', err?.message || err);
      }
    }

    // Native: Capacitor app-state listener.
    let nativeListenerHandle;
    if (isNative()) {
      (async () => {
        try {
          const { App } = await import('@capacitor/app');
          nativeListenerHandle = await App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) fire();
          });
        } catch (err) {
          console.warn('[useAppForegroundRefresh] failed to attach native listener:', err?.message || err);
        }
      })();
    }

    // Web: visibilitychange (tab becomes visible) + pageshow (bfcache
    // restore). Both fire when the user comes back, so dedupe via the
    // shared throttle.
    function onVisibility() {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') fire();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', onVisibility);
    }

    return () => {
      cancelled = true;
      try { nativeListenerHandle?.remove?.(); } catch { /* no-op */ }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', onVisibility);
      }
    };
  }, [throttleMs]);
}
