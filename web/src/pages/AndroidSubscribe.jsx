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
import PremiumPaywall from '../components/PremiumPaywall';
import api from '../lib/api';

const FEATURES = [
  'Unlimited AI - ask by text, photo or voice note',
  'School letters: snap or forward, dates land themselves',
  'Morning & evening briefs, weekly digest',
  'Google, Apple & Outlook calendars in one place',
  'Document vault for paperwork & memories',
  'Attach files to the events they belong to',
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
          style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, letterSpacing: '-0.02em' }}
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
  const { isActive, refresh } = useSubscription();

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

  // ── Household members for the coverage row ─────────────────────
  const [members, setMembers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.get('/household')
      .then(({ data }) => { if (!cancelled) setMembers(data.members ?? []); })
      .catch(() => { /* the row simply hides */ });
    return () => { cancelled = true; };
  }, []);

  const monthlyPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_monthly' || p.packageType === 'MONTHLY'
  );
  const annualPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_annual' || p.packageType === 'ANNUAL'
  );

  const handlePaywallPurchase = useCallback((plan) => {
    const pkg = plan === 'annual' ? annualPkg : monthlyPkg;
    if (pkg) handlePurchase(pkg);
  }, [annualPkg, monthlyPkg, handlePurchase]);

  if (isActive) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <h1 style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 28, color: '#1A1620' }}>
          You&rsquo;re already subscribed
        </h1>
        <p className="text-sm text-warm-grey mt-2">You have full access. Manage your subscription in the Play Store.</p>
        <button
          type="button" onClick={() => navigate('/dashboard', { replace: true })}
          className="mt-6 px-6 py-3 rounded-2xl bg-plum text-white font-semibold"
        >
          Back to Housemait
        </button>
      </div>
    );
  }

  return (
    <PremiumPaywall
      members={members}
      monthly={{
        available: !!monthlyPkg,
        perMonth: monthlyPkg?.product?.priceString || null,
        sub: 'Pay as you go',
        ctaPrice: monthlyPkg?.product?.priceString || null,
        amount: monthlyPkg?.product?.price,
        currencyCode: monthlyPkg?.product?.currencyCode,
      }}
      annual={{
        available: !!annualPkg,
        perMonth: computeAnnualPerMonth(annualPkg),
        sub: annualPkg?.product?.priceString ? `Billed ${annualPkg.product.priceString} once a year` : 'Billed once a year',
        ctaPrice: annualPkg?.product?.priceString || null,
        amount: annualPkg?.product?.price,
        currencyCode: annualPkg?.product?.currencyCode,
      }}
      onPurchase={handlePaywallPurchase}
      onRestore={handleRestore}
      onClose={() => navigate(-1)}
      busy={submitting}
      confirming={confirming || loadingOffering}
      error={error}
      onDismissError={() => setError('')}
      finePrint={(
        <>
          <span>Auto-renews until cancelled in Play Store &rarr; Payments &amp; subscriptions</span>
          <Link to="/terms" className="underline" style={{ textUnderlineOffset: 2 }}>Terms</Link>
          <Link to="/privacy" className="underline" style={{ textUnderlineOffset: 2 }}>Privacy</Link>
          <Link to="/settings?section=delete" className="underline" style={{ textUnderlineOffset: 2 }}>Delete my account</Link>
        </>
      )}
    />
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
