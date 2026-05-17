/**
 * Cookie consent banner.
 *
 * PECR + UK GDPR require an explicit opt-in for non-essential tracking
 * cookies (currently just Google Analytics). The banner appears once for
 * any visitor who hasn't recorded a choice in localStorage, with two
 * options of equal prominence: "Accept" and "Decline" — the ICO requires
 * declining to be no harder than accepting, so they're styled symmetrically
 * (the same hover-treated outline button), not as a dimmed afterthought.
 *
 * Mounted once at the App level so it shows over every public route.
 * On any auth'd in-app route the banner will still surface if no choice
 * exists — that's intentional, the legal requirement applies regardless
 * of whether the visitor is signed in.
 *
 * Hidden on iOS native (Capacitor) — Google Analytics is not loaded
 * inside the iOS app bundle (the gtag <script> in index.html only fires
 * in real browser environments), and the iOS app discloses analytics
 * separately via the App Privacy nutrition labels in App Store Connect.
 * The PECR/GDPR cookie-banner requirement applies to the *web* surface
 * where actual cookies could be set; in the iOS WebView there's nothing
 * to consent to.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { getConsent, setConsent } from '../lib/analytics';

const isNative = () => {
  try { return Capacitor.isNativePlatform(); }
  catch { return false; }
};

export default function ConsentBanner() {
  const [choice, setChoice] = useState(() => getConsent());

  // Native apps don't need a cookie banner — see top-of-file comment.
  if (isNative()) return null;
  if (choice) return null;

  function decide(value) {
    setConsent(value);
    setChoice(value);
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[60] px-4 pb-safe md:px-6 pointer-events-none"
    >
      <div
        className="mx-auto max-w-3xl bg-white border border-cream-border rounded-2xl shadow-[0_10px_30px_-12px_rgba(74,29,130,0.18),0_4px_12px_rgba(27,20,36,0.06)] p-5 md:p-6 pointer-events-auto"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <p className="text-sm text-charcoal leading-relaxed flex-1">
            We use a few cookies to keep Housemait running, and (if you're
            happy with it) Google Analytics to understand which pages help
            families the most. You're in control — see our{' '}
            <Link to="/privacy" className="text-plum hover:underline font-medium">Privacy Policy</Link>{' '}
            for details.
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => decide('declined')}
              className="px-5 py-2.5 rounded-xl border border-light-grey text-charcoal text-sm font-semibold hover:border-plum hover:text-plum transition-colors"
            >
              Decline
            </button>
            <button
              type="button"
              onClick={() => decide('accepted')}
              className="px-5 py-2.5 rounded-xl bg-plum text-white text-sm font-semibold hover:bg-plum-pressed transition-colors"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
