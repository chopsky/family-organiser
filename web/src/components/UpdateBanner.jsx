/**
 * "Update available" banner shown on the iOS native app only.
 *
 * Mounted at the App-shell level so it's visible on every authenticated
 * screen. Polls Apple's iTunes lookup once on mount + once per hour
 * thereafter (a longer interval would miss patches; shorter spams the
 * API). Silently no-ops on web - returns null before any visible chrome.
 *
 * UX:
 *   - Fixed at the bottom of the viewport, above the iOS tab bar.
 *   - Two buttons: "Update" (opens App Store listing) + "Later" (close,
 *     suppress for this version only - newer versions still re-prompt).
 *   - Slides in after a 2s delay so it doesn't fight the splash/onboarding.
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { checkForUpdate, dismissUpdateForVersion, wasUpdateDismissed } from '../lib/update-checker';

// Re-check at most once an hour while the app is open - users who leave
// it backgrounded for a day will get a fresh check on the next foreground
// regardless (useAppForegroundRefresh would also pick that up, but we
// don't depend on it here to stay independent).
const POLL_INTERVAL_MS = 60 * 60 * 1000;
// Initial delay so the banner doesn't collide with the splash screen
// or the welcome bubble on a fresh login.
const INITIAL_DELAY_MS = 2000;

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pollId = null;
    let delayId = null;

    async function runCheck() {
      try {
        const result = await checkForUpdate();
        if (cancelled) return;
        if (!result) return;
        if (wasUpdateDismissed(result.latestVersion)) return;
        setUpdate(result);
      } catch {
        // checkForUpdate already swallows errors - this catch is just
        // defensive belt-and-braces.
      }
    }

    delayId = setTimeout(() => {
      runCheck();
      pollId = setInterval(runCheck, POLL_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      if (delayId) clearTimeout(delayId);
      if (pollId) clearInterval(pollId);
    };
  }, []);

  if (!update || dismissed) return null;

  function handleUpdate() {
    // Capacitor's Browser plugin would also work, but a plain
    // window.open is simpler and iOS hands the App Store URL off to
    // the App Store app via universal link handling. trackViewUrl
    // returned by Apple's lookup is the canonical link.
    try {
      window.open(update.storeUrl, '_blank');
    } catch {
      // Last-ditch fallback if open is blocked - assign location.
      window.location.href = update.storeUrl;
    }
  }

  function handleLater() {
    dismissUpdateForVersion(update.latestVersion);
    setDismissed(true);
  }

  return (
    <div
      role="dialog"
      aria-label="App update available"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        // Sit above the iOS tab bar (~82px) with breathing room. On
        // pages without a tab bar the extra 12px just adds a margin
        // from the home indicator.
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 94px)',
        zIndex: 9999,
        background: '#FFFFFF',
        borderRadius: 16,
        boxShadow: '0 8px 24px rgba(107, 63, 160, 0.18)',
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        border: '1px solid var(--light-grey, #E8E5EC)',
      }}
    >
      <span style={{ fontSize: 24 }}>✨</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--charcoal, #2D2A33)', fontSize: 14, lineHeight: 1.2 }}>
          New Housemait update
        </div>
        <div style={{ fontSize: 12, color: 'var(--warm-grey, #6B6774)', marginTop: 2 }}>
          v{update.latestVersion} is on the App Store
        </div>
      </div>
      <button
        type="button"
        onClick={handleLater}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--warm-grey, #6B6774)',
          fontSize: 13,
          fontWeight: 500,
          padding: '6px 10px',
          cursor: 'pointer',
        }}
      >
        Later
      </button>
      <button
        type="button"
        onClick={handleUpdate}
        style={{
          background: 'var(--plum, #6B3FA0)',
          color: '#fff',
          border: 'none',
          borderRadius: 999,
          padding: '8px 16px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Update
      </button>
    </div>
  );
}

// Defensive export: callers that import this component on platforms
// where Capacitor isn't available (e.g. server-side rendering in test)
// still want to render nothing rather than throw.
export function UpdateBannerSafe() {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    return <UpdateBanner />;
  } catch {
    return null;
  }
}
