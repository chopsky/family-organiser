/**
 * Subscribe success page — Phase 5.
 *
 * Stripe Checkout redirects here on successful payment:
 *   /subscription/success?session_id=cs_test_...
 *
 * What happens:
 *   1. Immediately call refresh() to pull the new subscription_status
 *      from the backend. The Stripe webhook usually lands before the
 *      user's redirect does, but there's a small window where it hasn't
 *      — we retry the refresh a few times to cover the gap.
 *   2. Show a confirmation + auto-redirect to /dashboard after 3 seconds.
 *      Users can click "Go to dashboard now" to skip the wait.
 *
 * session_id is kept in the URL but not sent to the backend — the
 * webhook already carries the session id and handles it end-to-end.
 * The query param is only for future analytics / debugging.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSubscription } from '../context/SubscriptionContext';
import { isIos } from '../lib/platform';

const AUTO_REDIRECT_MS = 3000;

// Webhook-race: if the frontend redirect beats the webhook, the first
// refresh() will still show the old status. Retry a handful of times
// over ~5s before giving up. User sees "confirming…" during this window.
const REFRESH_RETRIES = [500, 1000, 1500, 2000]; // cumulative ~5s

export default function SubscribeSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh, isActive } = useSubscription();
  const sessionId = searchParams.get('session_id');
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_MS / 1000);

  // Refresh the subscription context — retry until we see isActive=true
  // or the retry budget is exhausted (webhook may have been delayed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refresh();
      for (const delay of REFRESH_RETRIES) {
        if (cancelled || isActive) return;
        await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        await refresh();
      }
    })();
    return () => { cancelled = true; };
    // Intentionally empty deps — run once on mount. refresh is stable
    // from context; isActive is read fresh inside the loop via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App Store guideline 3.1.1: this page is a Stripe-return URL and
  // mentions "subscription" / "Stripe" — neither should ever be visible
  // to an iOS reviewer. The /subscribe redirect on iOS already prevents
  // the user from getting here organically, but a manually-typed deep
  // link could still hit this route. Bounce to /dashboard.
  useEffect(() => {
    if (isIos()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  // Auto-redirect countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          navigate('/dashboard', { replace: true });
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [navigate]);

  // Don't even render the success UI on iOS — the redirect above will
  // navigate away on next tick, but flashing the subscription confirmation
  // for that tick is undesirable.
  if (isIos()) return null;

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-[0_4px_16px_rgba(107,63,160,0.08)] border border-cream-border p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-sage-light flex items-center justify-center mx-auto mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4A7D50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1
            className="text-[28px] text-charcoal mb-2"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            Welcome aboard!
          </h1>
          <p className="text-cocoa text-base mb-6">
            Your subscription is active. Your whole household has full access now.
          </p>

          {!isActive && (
            <p className="text-xs text-warm-grey mb-5 italic">
              Confirming payment with Stripe — this only takes a moment.
            </p>
          )}

          <Link
            to="/dashboard"
            className="inline-block w-full bg-plum hover:bg-plum-pressed text-white font-semibold py-3 px-6 rounded-xl transition-colors"
          >
            Go to dashboard now
          </Link>

          <p className="text-xs text-warm-grey mt-4">
            Redirecting in {countdown} {countdown === 1 ? 'second' : 'seconds'}…
          </p>

          {sessionId && (
            <p className="text-[10px] text-warm-grey/60 mt-6 font-mono break-all">
              Ref: {sessionId}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
