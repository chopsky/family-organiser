/**
 * Cloudflare Turnstile widget — bot verification on Login, Signup,
 * ForgotPassword, and Support forms.
 *
 * Mostly invisible: most users see no challenge. Only suspicious sessions
 * (rapid retries, datacenter IPs, mismatched fingerprints) get an
 * interactive challenge. Those that do, see a small embedded checkbox.
 *
 * Wires the official Cloudflare script lazily so it only loads on pages
 * that need it (not on every route). Calls onChange with the token
 * once the user/script has cleared the challenge. Parent component
 * forwards the token to the API as `turnstile_token` in the request body.
 *
 * If VITE_TURNSTILE_SITE_KEY isn't set (dev / pre-rollout), renders nothing
 * and immediately calls onChange(null). Server-side middleware also
 * fail-opens in this case, so forms keep working.
 */

import { useEffect, useRef } from 'react';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad';

let scriptLoading = null; // shared promise so multiple mounts don't load the script N times

function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise((resolve, reject) => {
    window.__turnstileOnLoad = () => resolve();
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(s);
  });
  return scriptLoading;
}

export default function TurnstileWidget({ onChange, theme = 'light' }) {
  const ref = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    // No site key configured → bypass. Server-side middleware also fail-opens.
    // Lets local dev work without Cloudflare creds.
    if (!SITE_KEY) {
      onChange?.(null);
      return;
    }

    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY,
          theme,
          callback: (token) => onChange?.(token),
          'error-callback': () => onChange?.(null),
          'expired-callback': () => onChange?.(null),
        });
      })
      .catch((err) => {
        // Network blocked Cloudflare or similar. Surface null so the form
        // submission isn't held up forever; server-side decides whether
        // to enforce.
        console.warn('[turnstile] widget load failed:', err.message);
        onChange?.(null);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* widget already gone */ }
        widgetIdRef.current = null;
      }
    };
  // onChange is intentionally excluded — wrapping it in useCallback in every
  // parent would be noise. Re-rendering only when SITE_KEY/theme changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  if (!SITE_KEY) return null;

  return <div ref={ref} className="turnstile-container my-3" />;
}
