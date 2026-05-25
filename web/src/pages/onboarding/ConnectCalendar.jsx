/**
 * Step 4 - subscribe the user's phone / desktop calendar to the Housemait
 * outbound iCal feed so events they create in Housemait show up in Apple
 * Calendar / Google / Outlook automatically.
 *
 * The whole flow already exists on the Settings → Connect Calendars
 * surface (web/src/pages/Settings.jsx). This step is a wizard-shaped
 * wrapper that auto-mints the feed token on mount, surfaces the same
 * three affordances (Subscribe in Apple Calendar / Copy URL / Skip), and
 * advances the wizard regardless of whether the user actually subscribes
 * (no per-household cost to a minted-but-unused token; we can prompt
 * again from Settings if needed).
 *
 * webcal:// links inside Capacitor WKWebView are routed via
 * UIApplication.shared.open(), so tapping "Subscribe in Apple Calendar"
 * on the iOS app opens Calendar.app with a one-tap subscribe sheet.
 * Same scheme on macOS web. Other browsers (Chrome on Android, Windows
 * desktop) ignore the click and fall back to the Copy URL flow.
 */

import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { isIos } from '../../lib/platform';
import {
  serifHeading, serifHeadingStyle, kicker, primaryBtn, skipLink,
} from './_styles';

export default function ConnectCalendar({ next, setError }) {
  const [feedUrl, setFeedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const isIosPlatform = isIos();

  // Auto-mint the feed token on step mount. GET /calendar/feed-token is
  // idempotent (db.getOrCreateFeedToken returns the existing token on
  // repeat calls), so retries / re-renders are safe. This differs from
  // Settings's mount behaviour - Settings uses the non-creating
  // /feed-token/status to avoid auto-minting on a passive page visit;
  // onboarding is an explicit "set things up" moment so auto-mint fits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/calendar/feed-token');
        if (!cancelled) setFeedUrl(data.feedUrl);
      } catch (err) {
        if (!cancelled) setError?.(err.response?.data?.error || 'Could not generate calendar feed. You can do this later in Settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setError]);

  async function handleCopy() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can fail in non-secure contexts / older browsers.
      // The URL is on-screen for the user to read + retype manually.
    }
  }

  return (
    <div>
      <div className="text-center">
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Step 4 - Calendar
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          See Housemait in your <i>calendar</i>.
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          {isIosPlatform
            ? 'Add the Housemait feed to your iPhone calendar. Events you create here show up there automatically.'
            : 'Add the Housemait feed to your Apple / Google / Outlook calendar. Events you create here show up there automatically.'}
        </p>
      </div>

      <div className="mt-8 max-w-md mx-auto">
        {loading ? (
          <div className="flex justify-center py-6 text-sm text-cocoa">Setting up your feed…</div>
        ) : feedUrl ? (
          <div className="space-y-3">
            {/* Apple Calendar - tappable webcal:// link. iOS / macOS
                hand the scheme to Calendar.app which shows a native
                one-tap subscribe sheet. On other browsers (Chrome on
                Android, Edge) clicking is a no-op - those users will
                use the copy-URL flow below. */}
            <a
              href={feedUrl.replace(/^https?:\/\//, 'webcal://')}
              className={`${primaryBtn} w-full`}
            >
              Subscribe in Apple Calendar
            </a>
            {isIosPlatform && (
              <p className="text-xs text-cocoa text-center">
                Opens the iOS Calendar app with a one-tap confirm.
              </p>
            )}

            <div className="pt-3 border-t border-cream-border">
              <p className="text-xs font-medium text-bark mb-2">
                {isIosPlatform ? 'Google Calendar or Outlook? Copy the URL:' : 'Or copy the URL for Google / Outlook:'}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={feedUrl}
                  className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-xs bg-oat text-cocoa select-all"
                  onClick={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="border border-cream-border text-bark hover:bg-cream font-medium px-3 py-2 rounded-2xl text-xs transition-colors whitespace-nowrap"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              {!isIosPlatform && (
                <div className="text-xs text-cocoa mt-2 space-y-1">
                  <p><span className="font-medium">Google:</span> Settings → Add calendar → From URL.</p>
                  <p><span className="font-medium">Outlook:</span> Add calendar → Subscribe from web.</p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        <button type="button" onClick={next} className={primaryBtn}>
          Continue →
        </button>
        <button type="button" onClick={next} className={skipLink}>
          Skip for now
        </button>
      </div>
    </div>
  );
}
