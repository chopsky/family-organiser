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

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Capacitor } from '@capacitor/core';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad';

// Skip Turnstile entirely on iOS native. Reasoning:
//   • The threat model for a signed App Store binary is fundamentally
//     different from web — no bot signups via App Review's flow, no
//     credential stuffing from a controlled native binary.
//   • Loading the Cloudflare script in the WebView introduces race
//     conditions where users (especially App Reviewers using iPad
//     hardware keyboards) can submit before a token is ready, resulting
//     in opaque "login failed" errors. Apple rejected 1.1.0(8) for
//     exactly this — Guideline 2.1(a), iPad login error.
//   • Server-side middleware fail-opens when the request lacks a token,
//     so the iOS native flow is allowed. See src/middleware/turnstile.js.
function isIosNative() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

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

/**
 * forwardRef so parent forms can imperatively call `reset()` on a failed
 * submission. Turnstile tokens are SINGLE-USE — once the backend has
 * validated one (even before deciding the request itself was bad), that
 * token is dead. Parents that don't reset after an error will trip the
 * "Bot verification failed" message on the next submit, even though the
 * widget visually still shows "Success!" (it only auto-resets on its
 * own 5-min expiry, not on submission).
 *
 * Usage:
 *   const turnstileRef = useRef(null);
 *   <TurnstileWidget ref={turnstileRef} onChange={setToken} />
 *   // After any backend error:
 *   turnstileRef.current?.reset();
 */
const TurnstileWidget = forwardRef(function TurnstileWidget(
  { onChange, theme = 'light' },
  ref,
) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.reset(widgetIdRef.current); } catch { /* widget gone */ }
      }
    },
  }), []);

  useEffect(() => {
    // iOS native bypass — see top-of-file comment.
    if (isIosNative()) {
      onChange?.(null);
      return;
    }

    // No site key configured → bypass. Server-side middleware also fail-opens.
    // Lets local dev work without Cloudflare creds.
    if (!SITE_KEY) {
      onChange?.(null);
      return;
    }

    let cancelled = false;
    let scriptLoadStarted = false;

    // Defer loading Cloudflare's script until the user has actually
    // interacted with the page. Loading the script on mount blocks iOS
    // WebView's tap-event delivery for ~1-2 seconds — even with
    // size:invisible — because the script execution and iframe creation
    // run on the main thread during the WebView's first paint.
    //
    // First interaction (focus / pointerdown / keydown / touchstart on
    // the document) tells us the user has the form responsive. By the
    // time they finish typing and hit Submit, the script has loaded and
    // produced a token in the background.
    //
    // 5s fallback timer covers the edge case of a user who lands on the
    // page and never interacts with anything (rare — they came here for
    // a reason). After 5s we load anyway so the widget isn't held up
    // forever for an idle user.
    function startScriptLoad() {
      if (scriptLoadStarted || cancelled) return;
      scriptLoadStarted = true;
      cleanupListeners();
      loadAndRenderWidget();
    }

    const interactionEvents = ['pointerdown', 'keydown', 'focusin', 'touchstart'];
    function cleanupListeners() {
      interactionEvents.forEach((evt) =>
        document.removeEventListener(evt, startScriptLoad, true)
      );
      clearTimeout(fallbackTimer);
    }

    interactionEvents.forEach((evt) =>
      document.addEventListener(evt, startScriptLoad, { capture: true, passive: true })
    );
    const fallbackTimer = setTimeout(startScriptLoad, 5000);

    function loadAndRenderWidget() {
      loadScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return;
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: SITE_KEY,
            theme,
            // 'invisible' = no visible iframe, no layout shift, no UI element
            // for the user to wait on. Cloudflare runs the challenge silently
            // in the background; suspicious sessions still get an interactive
            // prompt only when needed. Fixes an iOS WebView issue where the
            // iframe load was eating tap-to-focus events on email/password
            // inputs for the first 1-2 seconds, making the form feel locked.
            size: 'invisible',
            // 'refresh-expired: auto' tells Cloudflare to silently issue a new
            // challenge when the previous token expires (default TTL: 5 min).
            // Without this, a user who lingers on the login page (typing
            // slowly, reading, switching apps on iOS so the WebView suspends)
            // submits with an expired token, Cloudflare rejects it as
            // "invalid token", our middleware returns 403, and the user sees
            // a generic auth failure they can't recover from. App Review
            // hits this constantly.
            'refresh-expired': 'auto',
            callback: (token) => onChange?.(token),
            'error-callback': () => {
              onChange?.(null);
              // Force a fresh challenge so the user's next submission isn't
              // doomed to fail with the same stale state.
              try { window.turnstile.reset(widgetIdRef.current); } catch { /* widget already gone */ }
            },
            'expired-callback': () => onChange?.(null),
            // Note: with refresh-expired:auto, expired-callback fires THEN
            // Turnstile auto-resets, so we just clear the parent's token.
            // The new challenge produces a fresh token via `callback`.
          });
        })
        .catch((err) => {
          // Network blocked Cloudflare or similar. Surface null so the form
          // submission isn't held up forever; server-side decides whether
          // to enforce.
          console.warn('[turnstile] widget load failed:', err.message);
          onChange?.(null);
        });
    }

    return () => {
      cancelled = true;
      cleanupListeners();
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* widget already gone */ }
        widgetIdRef.current = null;
      }
    };
  // onChange is intentionally excluded — wrapping it in useCallback in every
  // parent would be noise. Re-rendering only when SITE_KEY/theme changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  if (!SITE_KEY || isIosNative()) return null;

  return <div ref={containerRef} className="turnstile-container my-3" />;
});

export default TurnstileWidget;
