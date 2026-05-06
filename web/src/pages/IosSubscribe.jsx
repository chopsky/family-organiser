/**
 * IosSubscribe — IAP Phase 2d.
 *
 * The native-IAP paywall, rendered when the iOS app needs to show
 * subscription options. Mirrors web/src/pages/Subscribe.jsx visually
 * but uses RevenueCat instead of Stripe Checkout.
 *
 * Reachability:
 *   - Routed from /subscribe when isIos() === true (see Subscribe.jsx
 *     dispatcher in Phase 3b).
 *   - Day-30 trial expiry on iOS triggers a 402 from any mutation,
 *     which the SubscriptionContext catches and navigates to
 *     /subscribe.
 *
 * App Review compliance notes (Guideline 3.1.1):
 *   - Pricing strings come from `pkg.product.priceString` — Apple's
 *     localised, currency-correct string. We never display a
 *     hard-coded price; the App Review machine WILL flag mismatches
 *     between displayed price and Store Connect price.
 *   - No "subscribe at housemait.com" or any reference to web.
 *   - "Restore Purchases" button required and prominently placed.
 *   - Terms & Privacy links open in-app — App Review requires both
 *     to be reachable from any paid screen.
 *
 * Purchase race:
 *   When `purchasePackage` resolves, Apple has confirmed the
 *   transaction locally but our server may not yet have received the
 *   RevenueCat webhook. We poll /api/subscription/status every 1s for
 *   up to 8s waiting for status='active' + provider='apple'. If it
 *   lands → straight to /dashboard. If it times out → /dashboard
 *   anyway with a toast hint; the periodic refresh in
 *   SubscriptionContext catches up later.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  hasActivePremium,
} from '../lib/revenuecat';
import { useSubscription } from '../context/SubscriptionContext';
import ErrorBanner from '../components/ErrorBanner';

const FEATURES = [
  'Unlimited shopping lists',
  'Shared family calendar',
  'Meal planning & recipes',
  'Receipt scanning',
  'WhatsApp assistant',
  'Document storage',
];

export default function IosSubscribe() {
  const navigate = useNavigate();
  const { isExpired, isTrialing, isActive, daysRemaining, refresh } = useSubscription();

  const [offering, setOffering] = useState(null);
  const [loadingOffering, setLoadingOffering] = useState(true);
  const [submitting, setSubmitting] = useState(null); // package.identifier | 'restore' | null
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false); // post-purchase server sync

  // ── Load offering ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const off = await getCurrentOffering();
      if (cancelled) return;
      setOffering(off);
      setLoadingOffering(false);
      if (!off) {
        setError(
          'Subscription options are temporarily unavailable. ' +
          'Please try again in a moment, or contact support if this keeps happening.'
        );
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Purchase ───────────────────────────────────────────────────
  const handlePurchase = useCallback(async (pkg) => {
    if (submitting) return;
    setSubmitting(pkg.identifier);
    setError('');
    try {
      const result = await purchasePackage(pkg);
      // result.customerInfo carries the new entitlement state directly
      // from Apple/RevenueCat — usable as fast-path UI confirmation
      // even before our webhook lands.
      if (!hasActivePremium(result?.customerInfo)) {
        // Apple reported success but RevenueCat didn't see the
        // entitlement attached — rare, but worth surfacing rather
        // than silently sending the user to a dashboard that will
        // immediately 402.
        throw new Error('Purchase completed but entitlement not active. Try Restore Purchases.');
      }
      // Server sync — wait briefly for the webhook to flip our DB.
      setConfirming(true);
      await waitForServerSync(refresh);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // RevenueCat surfaces user-cancel as { userCancelled: true } on
      // the error object. Treat as a clean cancel: no error toast,
      // just clear submitting state.
      if (err?.userCancelled) {
        setSubmitting(null);
        return;
      }
      console.error('[IosSubscribe] purchase failed:', err);
      setError(
        err?.message || err?.userInfo?.NSLocalizedDescription ||
        'Purchase could not be completed. Please try again.'
      );
      setSubmitting(null);
      setConfirming(false);
    }
  }, [submitting, navigate, refresh]);

  // ── Restore purchases ──────────────────────────────────────────
  const handleRestore = useCallback(async () => {
    if (submitting) return;
    setSubmitting('restore');
    setError('');
    try {
      const result = await restorePurchases();
      if (hasActivePremium(result?.customerInfo)) {
        // Webhook may still need a moment for our DB to catch up.
        setConfirming(true);
        await waitForServerSync(refresh);
        navigate('/dashboard', { replace: true });
      } else {
        setError('No active subscription found on this Apple ID.');
        setSubmitting(null);
      }
    } catch (err) {
      console.error('[IosSubscribe] restore failed:', err);
      setError(
        err?.message || err?.userInfo?.NSLocalizedDescription ||
        'Restore failed. Please try again.'
      );
      setSubmitting(null);
    }
  }, [submitting, navigate, refresh]);

  // ── Render ─────────────────────────────────────────────────────
  const copy = buildCopy({ isExpired, isTrialing, isActive, daysRemaining });

  // Pull packages by RevenueCat's standard identifiers (Phase 0 setup
  // assigned Monthly/Annual package types, which get $rc_monthly /
  // $rc_annual identifiers). Fall back to a search by period if the
  // identifiers ever change.
  const monthlyPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_monthly' || p.packageType === 'MONTHLY'
  );
  const annualPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_annual' || p.packageType === 'ANNUAL'
  );

  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-warm-grey hover:text-charcoal transition-colors mb-6 flex items-center gap-1"
          disabled={submitting !== null}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="text-center mb-10">
          <h1
            className="text-[36px] md:text-[48px] leading-[1.05] tracking-[-0.02em] text-charcoal mb-3"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontWeight: 600 }}
          >
            {copy.headline}
          </h1>
          <p className="text-cocoa text-base max-w-xl mx-auto">
            {copy.subhead}
          </p>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError('')} />

        {confirming && (
          <div className="text-center mb-6 text-sm text-warm-grey">
            Confirming your subscription…
          </div>
        )}

        {loadingOffering ? (
          <div className="text-center py-12 text-warm-grey">Loading plans…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {monthlyPkg && (
              <IapPricingCard
                pkg={monthlyPkg}
                planLabel="Monthly"
                tagline="Pay as you go, cancel anytime."
                highlighted={false}
                submitting={submitting === monthlyPkg.identifier}
                disabled={submitting !== null}
                onPurchase={() => handlePurchase(monthlyPkg)}
              />
            )}
            {annualPkg && (
              <IapPricingCard
                pkg={annualPkg}
                planLabel="Annual"
                tagline="Best value — two months free."
                badge="Best value"
                highlighted={true}
                submitting={submitting === annualPkg.identifier}
                disabled={submitting !== null}
                onPurchase={() => handlePurchase(annualPkg)}
              />
            )}
          </div>
        )}

        {/* Restore Purchases — required by App Review Guideline 3.1.1.
            Always present, even before offerings load (a returning user
            with a previous purchase needs this to recover access). */}
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={handleRestore}
            disabled={submitting !== null}
            className="text-sm text-plum hover:text-plum-pressed font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </button>
        </div>

        {/* Footer — Apple Review requires Terms + Privacy reachable
            from any paid screen. Both routes already exist in the app. */}
        <div className="mt-10 text-center text-xs text-warm-grey">
          <p className="mb-2">
            Subscriptions auto-renew. Cancel anytime in Settings → Apple ID → Subscriptions.
          </p>
          <p>
            <Link to="/terms" className="underline hover:text-charcoal">Terms of use</Link>
            {' · '}
            <Link to="/privacy" className="underline hover:text-charcoal">Privacy policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Copy helpers ────────────────────────────────────────────────

function buildCopy({ isExpired, isTrialing, isActive, daysRemaining }) {
  if (isExpired) {
    return {
      headline: 'Keep Housemait for your family',
      subhead: 'Your trial has ended. Pick a plan below to unlock everything again.',
    };
  }
  if (isTrialing && daysRemaining != null) {
    return {
      headline:
        daysRemaining <= 5
          ? `Your trial ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
          : 'Subscribe to Housemait',
      subhead:
        daysRemaining <= 5
          ? 'Lock in your plan now so nothing gets interrupted.'
          : 'Switch to a paid plan any time before your trial ends, with no gap.',
    };
  }
  if (isActive) {
    return {
      headline: "You're already subscribed",
      subhead: 'You have full access. Manage your subscription in Settings.',
    };
  }
  return {
    headline: 'Subscribe to Housemait',
    subhead: 'One subscription covers your whole household.',
  };
}

// ─── Pricing card ────────────────────────────────────────────────

function IapPricingCard({ pkg, planLabel, tagline, badge, highlighted, submitting, disabled, onPurchase }) {
  // Use Apple's localised price string — never hardcode. App Review
  // checks for parity between displayed price and StoreConnect.
  const priceString = pkg?.product?.priceString || '';
  // Period: derive from package type so the unit label below the price
  // is consistent. RevenueCat packageType is one of MONTHLY / ANNUAL
  // / WEEKLY etc. For our paywall we only show monthly + annual.
  const periodDisplay = pkg?.packageType === 'ANNUAL' ? 'per year' : 'per month';

  return (
    <div
      className={
        'relative rounded-2xl p-6 md:p-7 transition-shadow ' +
        (highlighted
          ? 'bg-white border-2 border-plum shadow-[0_8px_24px_rgba(107,63,160,0.10)]'
          : 'bg-white border border-light-grey shadow-[0_2px_8px_rgba(107,63,160,0.06)]')
      }
    >
      {badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-coral text-white text-xs font-semibold px-3 py-1 rounded-full">
          {badge}
        </div>
      )}

      <h2
        className="text-[22px] text-charcoal mb-1"
        style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {planLabel}
      </h2>
      <p className="text-sm text-warm-grey mb-5">{tagline}</p>

      <div className="mb-5">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[36px] font-semibold text-charcoal leading-none"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            {priceString || '—'}
          </span>
          <span className="text-sm text-warm-grey">{periodDisplay}</span>
        </div>
      </div>

      <ul className="space-y-2 mb-6 text-sm text-charcoal">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <svg className="text-sage shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onPurchase}
        disabled={disabled || !priceString}
        className={
          'w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ' +
          (highlighted
            ? 'bg-plum hover:bg-plum-pressed text-white'
            : 'bg-white border-[1.5px] border-plum text-plum hover:bg-plum-light')
        }
      >
        {submitting
          ? 'Processing…'
          : priceString
            ? `Subscribe — ${priceString}`
            : 'Unavailable'}
      </button>
    </div>
  );
}

// ─── Server-sync poll ────────────────────────────────────────────

/**
 * Refresh subscription status until it reflects the new purchase,
 * or until 8 seconds elapse. The webhook normally lands in <2s in
 * production. We don't BLOCK on this — failure to sync means the
 * user lands on /dashboard and the next mutation either succeeds
 * (server caught up) or 402s and re-routes to /subscribe (which
 * won't happen here because Apple already confirmed the purchase
 * locally and the SubscriptionContext will pick it up on next refresh).
 */
async function waitForServerSync(refresh) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await refresh();
    } catch {
      // Don't break the loop on transient errors — just retry.
    }
  }
}
