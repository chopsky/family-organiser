/**
 * AndroidSubscribe - the /subscribe destination on the native Android app.
 *
 * Two modes:
 *
 *  1. Play Billing paywall (when VITE_REVENUECAT_GOOGLE_KEY is set in the
 *     build env AND RevenueCat returns a current offering). Mirrors
 *     IosSubscribe deliberately - same RevenueCat SDK, same package
 *     identifiers ($rc_monthly / $rc_annual), same webhook confirms the
 *     purchase server-side (store PLAY_STORE -> provider 'google'). Prices
 *     come from Google Play's localised priceString - never hardcoded.
 *     Apple-specific features (offer-code redemption sheet, campaign promo
 *     claim) intentionally absent - Play has no equivalent sheet.
 *
 *  2. Neutral no-purchase notice (the dormant state). Google Play's
 *     payments policy requires Play Billing for in-app digital
 *     subscriptions and prohibits steering users to an external payment
 *     flow - so with no billing configured we show a neutral notice with
 *     no external link and no instruction on where to purchase. A
 *     household whose subscription was bought elsewhere (web Stripe or
 *     iOS IAP) is entitled account-wide, so Android members of a
 *     subscribed household are unaffected either way.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  hasActivePremium,
  iapKeyPresent,
} from '../lib/revenuecat';
import { useSubscription } from '../context/SubscriptionContext';
import ErrorBanner from '../components/ErrorBanner';

const FEATURES = [
  'Unlimited shopping lists',
  'Shared family calendar',
  'Meal planning & recipes',
  'Unlimited AI chat',
  'Receipt scanning',
  'WhatsApp assistant',
  'Document storage',
];

export default function AndroidSubscribe() {
  // Dormant state: no RevenueCat key in this build -> compliant notice,
  // no SDK calls at all.
  if (!iapKeyPresent()) return <NoPurchaseNotice />;
  return <PlayBillingPaywall />;
}

// ─── Mode 2: neutral notice (no billing configured) ────────────────

function NoPurchaseNotice() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-[0_4px_16px_rgba(107,63,160,0.08)] p-7 text-center">
        <div className="text-3xl mb-4" aria-hidden="true">🏡</div>
        <h1
          className="text-[26px] text-charcoal leading-tight mb-3"
          style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 600, letterSpacing: '-0.02em' }}
        >
          Subscriptions aren&apos;t available in this app
        </h1>
        <p className="text-cocoa text-[15px] leading-relaxed">
          Housemait subscriptions can&apos;t be purchased in the Android app just yet.
          Your family&apos;s data is safe, and any subscription already on your household
          works here automatically.
        </p>
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="mt-6 inline-flex items-center justify-center px-6 py-3 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
        >
          Back to Housemait
        </button>
      </div>
    </div>
  );
}

// ─── Mode 1: Google Play Billing paywall ───────────────────────────

function PlayBillingPaywall() {
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
      if (!hasActivePremium(result?.customerInfo)) {
        // Google reported success but RevenueCat didn't see the
        // entitlement attached - rare, but surface it rather than
        // sending the user to a dashboard that will immediately 402.
        throw new Error('Purchase completed but entitlement not active. Try Restore Purchases.');
      }
      // Server sync - wait briefly for the webhook to flip our DB.
      setConfirming(true);
      await waitForServerSync(refresh);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // RevenueCat surfaces user-cancel as { userCancelled: true } on
      // both stores. Treat as a clean cancel: no error toast.
      if (err?.userCancelled) {
        setSubmitting(null);
        return;
      }
      console.error('[AndroidSubscribe] purchase failed:', err);
      setError(err?.message || 'Purchase could not be completed. Please try again.');
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
        setConfirming(true);
        await waitForServerSync(refresh);
        navigate('/dashboard', { replace: true });
      } else {
        setError('No active subscription found on this Google account.');
        setSubmitting(null);
      }
    } catch (err) {
      console.error('[AndroidSubscribe] restore failed:', err);
      setError(err?.message || 'Restore failed. Please try again.');
      setSubmitting(null);
    }
  }, [submitting, navigate, refresh]);

  // ── Render ─────────────────────────────────────────────────────
  const copy = buildCopy({ isExpired, isTrialing, isActive, daysRemaining });

  const monthlyPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_monthly' || p.packageType === 'MONTHLY'
  );
  const annualPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_annual' || p.packageType === 'ANNUAL'
  );

  return (
    <div
      className="min-h-screen bg-cream pb-10 px-4"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}
    >
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-warm-grey hover:text-charcoal transition-colors mb-6 flex items-center gap-1 -ml-2 px-2 py-2"
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
            style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 600 }}
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
              <PlayPricingCard
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
              <PlayPricingCard
                pkg={annualPkg}
                planLabel="Annual"
                tagline="Best value - two months free."
                badge="Best value"
                highlighted={true}
                submitting={submitting === annualPkg.identifier}
                disabled={submitting !== null}
                onPurchase={() => handlePurchase(annualPkg)}
              />
            )}
          </div>
        )}

        {/* Restore - a returning user with a previous Play purchase on a
            fresh install recovers access here without paying twice. */}
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={handleRestore}
            disabled={submitting !== null}
            className="text-sm text-plum hover:text-plum-pressed font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </button>
        </div>

        <div className="mt-8 text-center text-xs text-warm-grey">
          <p>
            Payments are processed by Google Play. Your subscription is charged to your
            Google account and managed in the Play Store under Payments &amp; subscriptions.
          </p>
          <p className="mt-2">
            <Link to="/terms" className="underline hover:text-charcoal">Terms of use</Link>
            {' · '}
            <Link to="/privacy" className="underline hover:text-charcoal">Privacy policy</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Copy helpers (mirrors IosSubscribe) ────────────────────────────

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

function PlayPricingCard({ pkg, planLabel, tagline, badge, highlighted, submitting, disabled, onPurchase }) {
  // Google's localised price string - never hardcode; Play pricing is
  // per-storefront and the displayed price must match the console.
  const priceString = pkg?.product?.priceString || '';
  const isAnnual = pkg?.packageType === 'ANNUAL';
  const periodDisplay = isAnnual ? 'per year' : 'per month';
  const lengthDisclosure = isAnnual
    ? '1 year subscription, auto-renewing'
    : '1 month subscription, auto-renewing';
  const perUnitDisplay = isAnnual ? computeAnnualPerMonth(pkg) : null;
  const subscriptionTitle =
    pkg?.product?.title?.replace(/\s*\(.*\)\s*$/, '').trim() ||
    `Housemait Premium ${planLabel}`;

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
        style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {subscriptionTitle}
      </h2>
      <p className="text-sm text-warm-grey mb-5">{tagline}</p>

      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[36px] font-semibold text-charcoal leading-none"
            style={{ fontFamily: 'var(--font-serif-display)' }}
          >
            {priceString || '-'}
          </span>
          <span className="text-sm text-warm-grey">{periodDisplay}</span>
        </div>
        {perUnitDisplay && (
          <p className="text-xs text-warm-grey mt-1">
            (works out to {perUnitDisplay} per month)
          </p>
        )}
      </div>

      <p className="text-xs text-warm-grey mb-5">
        {lengthDisclosure}
      </p>

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
            ? `Subscribe - ${priceString}`
            : 'Unavailable'}
      </button>

      <p className="text-[11px] text-warm-grey mt-3 leading-snug">
        Auto-renews each {isAnnual ? 'year' : 'month'} until cancelled. Cancel anytime in
        the Play Store under Payments &amp; subscriptions at least 24 hours before the
        end of the current period. By subscribing you agree to the{' '}
        <Link to="/terms" className="underline">Terms of use</Link>
        {' '}and{' '}
        <Link to="/privacy" className="underline">Privacy policy</Link>.
      </p>
    </div>
  );
}

/**
 * Compute "per month" string from an annual package's localized price.
 * Returns null if the SDK doesn't expose a numeric price + currency -
 * never falls back to hardcoded values (displayed price must match the
 * Play Console).
 */
function computeAnnualPerMonth(pkg) {
  const priceObj = pkg?.product;
  const amount = priceObj?.price;
  const currencyCode = priceObj?.currencyCode;
  if (typeof amount !== 'number' || !currencyCode) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 12);
  } catch {
    return null;
  }
}

// ─── Server-sync poll (mirrors IosSubscribe) ─────────────────────

/**
 * Refresh subscription status until it reflects the new purchase, or
 * until 8 seconds elapse. The RevenueCat webhook normally lands in <2s.
 * Not blocking - Google already confirmed the purchase locally, and
 * SubscriptionContext picks the state up on its next refresh either way.
 */
async function waitForServerSync(refresh) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await refresh();
    } catch {
      // Don't break the loop on transient errors - just retry.
    }
  }
}
