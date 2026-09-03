/**
 * useUniversalLinks - turn iOS Universal Link opens into in-app navigations.
 *
 * When the user taps an https://housemait.com/verify?token=… link in
 * their Mail app on iOS, the Housemait app launches (or comes to
 * foreground) with the URL. Capacitor's App.appUrlOpen event fires
 * with that URL - we strip the host and feed the path + query into
 * React Router so the user lands on /verify and the verification
 * runs automatically.
 *
 * Web-safe: registers nothing on browsers (where Universal Links
 * don't apply - the link just navigates normally).
 *
 * Both cold-start and warm-resume launches go through appUrlOpen in
 * Capacitor 8, so we don't need a separate getLaunchUrl handler.
 *
 * Mount once near the router root (App.jsx, inside <BrowserRouter>).
 */

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';

const UNIVERSAL_LINK_HOSTS = new Set(['housemait.com', 'www.housemait.com']);

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function useUniversalLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;
    let handle;
    let cancelled = false;

    (async () => {
      try {
        const { App } = await import('@capacitor/app');
        handle = await App.addListener('appUrlOpen', ({ url }) => {
          if (cancelled || !url) return;
          let parsed;
          try { parsed = new URL(url); } catch { return; }

          // housemait:// - the home-screen widgets and the Live Activity.
          //   housemait://calendar        → the calendar
          //   housemait://chat           → the AI chat, keyboard up
          //   housemait://chat?voice=1   → the AI chat, dictating
          // The chat open is stashed as well as dispatched: on a cold start
          // the ChatWidget's listener may not be mounted yet, and it drains
          // the stash when it mounts (same contract the More sheet uses).
          if (parsed.protocol === 'housemait:') {
            const target = parsed.hostname.toLowerCase();
            if (target === 'chat') {
              const detail = parsed.searchParams.get('voice') === '1' ? { voice: true } : { focus: true };
              navigate('/dashboard');
              window.__housemaitPendingChatOpen = detail;
              window.dispatchEvent(new CustomEvent('openChatWidget', { detail }));
            } else if (target === 'calendar') {
              navigate('/calendar');
            }
            return;
          }

          // Only follow links to our own domain. Custom schemes (e.g.
          // OAuth callbacks via capacitor://) flow through other handlers.
          if (!UNIVERSAL_LINK_HOSTS.has(parsed.hostname.toLowerCase())) return;

          const inAppPath = parsed.pathname + parsed.search + parsed.hash;
          if (!inAppPath || inAppPath === '/') return;
          // replace: true so the back button doesn't take the user back
          // to whatever page they were on before the link fired (which
          // is usually /check-email, where we don't want them returning).
          navigate(inAppPath, { replace: true });
        });
      } catch (err) {
        console.warn('[universal-links] failed to attach listener:', err?.message || err);
      }
    })();

    return () => {
      cancelled = true;
      try { handle?.remove?.(); } catch { /* no-op */ }
    };
  }, [navigate]);
}
