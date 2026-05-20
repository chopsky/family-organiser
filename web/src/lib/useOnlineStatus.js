/**
 * useOnlineStatus - tracks browser/WebView network state.
 *
 * Uses the standard `navigator.onLine` flag plus `online` / `offline`
 * window events. Works identically in the browser and inside the
 * iOS Capacitor WebView, so no Capacitor plugin install is needed.
 *
 * Note: `navigator.onLine` only flips to false when the device has
 * NO connection at all. Captive portals, DNS failures and "wifi
 * connected but no internet" scenarios still report online=true.
 * That's a known browser limitation; we accept it and rely on
 * actual API failures as the second line of detection.
 */

import { useEffect, useState } from 'react';

export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  useEffect(() => {
    function handleOnline() { setOnline(true); }
    function handleOffline() { setOnline(false); }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
