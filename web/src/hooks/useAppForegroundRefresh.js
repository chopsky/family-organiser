/**
 * useAppForegroundRefresh — fire a callback whenever the iOS app
 * comes back to the foreground after being backgrounded.
 *
 * Native apps always feel current because they re-fetch on
 * foreground; web apps don't, because there's no equivalent
 * lifecycle event. The Capacitor App plugin gives us one.
 *
 * Usage:
 *
 *   useAppForegroundRefresh(() => {
 *     loadDashboard();
 *   });
 *
 * Mount near the top of any page that should "feel fresh" after the
 * user comes back to it. On web: no-op (the page would have been
 * unloaded if backgrounded long enough anyway).
 *
 * Throttled to once every 30s so a quick app-switch doesn't fire a
 * volley of refreshes.
 */

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

const REFRESH_THROTTLE_MS = 30 * 1000;

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function useAppForegroundRefresh(onForeground) {
  const lastFiredRef = useRef(0);
  const callbackRef = useRef(onForeground);

  // Keep the latest callback in a ref so the listener doesn't have
  // to re-subscribe on every render.
  useEffect(() => { callbackRef.current = onForeground; }, [onForeground]);

  useEffect(() => {
    if (!isNative()) return;

    let listenerHandle;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        listenerHandle = await App.addListener('appStateChange', ({ isActive }) => {
          if (cancelled || !isActive) return;
          const now = Date.now();
          if (now - lastFiredRef.current < REFRESH_THROTTLE_MS) return;
          lastFiredRef.current = now;
          try {
            callbackRef.current?.();
          } catch (err) {
            console.warn('[useAppForegroundRefresh] callback threw:', err?.message || err);
          }
        });
      } catch (err) {
        console.warn('[useAppForegroundRefresh] failed to attach listener:', err?.message || err);
      }
    })();

    return () => {
      cancelled = true;
      try { listenerHandle?.remove?.(); } catch { /* no-op */ }
    };
  }, []);
}
