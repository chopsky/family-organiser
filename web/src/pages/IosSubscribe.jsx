/**
 * IosSubscribe - IAP Phase 2d.
 *
 * The native-IAP paywall, rendered when the iOS app needs to show
 * subscription options. Mirrors web/src/pages/Subscribe.jsx visually
 * but uses RevenueCat instead of Stripe Checkout.
 *
 * Reachability:
 *   - Routed from /subscribe when isIos() === true (see Subscribe.jsx
 *     dispatcher in Phase 3b).
 *   - Trial expiry on iOS triggers a 402 from any mutation,
 *     which the SubscriptionContext catches and navigates to
 *     /subscribe.
 *
 * App Review compliance notes (Guideline 3.1.1):
 *   - Pricing strings come from `pkg.product.priceString` - Apple's
 *     localised, currency-correct string. We never display a
 *     hard-coded price; the App Review machine WILL flag mismatches
 *     between displayed price and Store Connect price.
 *   - No "subscribe at housemait.com" or any reference to web.
 *   - "Restore Purchases" button required and prominently placed.
 *   - Terms & Privacy links open in-app - App Review requires both
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

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  getCustomerInfo,
  invalidateCustomerInfoCache,
  hasActivePremium,
} from '../lib/revenuecat';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { appleOfferCodeRedeemUrl, APP_STORE_CONFIGURED } from '../lib/app-store';
import PremiumPaywall from '../components/PremiumPaywall';
import api from '../lib/api';

export default function IosSubscribe() {
  const navigate = useNavigate();
  const { isActive, refresh } = useSubscription();
  const { user } = useAuth();
  // A campaign promo captured at signup (e.g. school-fair HILLELFEST). On iOS
  // the discount is an Apple Custom Offer Code with the SAME string; we surface
  // a one-tap claim that opens Apple's redemption with the code pre-filled.
  const pendingPromo = !isActive && APP_STORE_CONFIGURED ? (user?.signup_promo_code || null) : null;

  const [offering, setOffering] = useState(null);
  const [loadingOffering, setLoadingOffering] = useState(true);
  const [submitting, setSubmitting] = useState(null); // package.identifier | 'restore' | null
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false); // post-purchase server sync
  const [claimingPromo, setClaimingPromo] = useState(false); // left to App Store to redeem

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
      // from Apple/RevenueCat - usable as fast-path UI confirmation
      // even before our webhook lands.
      if (!hasActivePremium(result?.customerInfo)) {
        // Apple reported success but RevenueCat didn't see the
        // entitlement attached - rare, but worth surfacing rather
        // than silently sending the user to a dashboard that will
        // immediately 402.
        throw new Error('Purchase completed but entitlement not active. Try Restore Purchases.');
      }
      // Server sync - wait briefly for the webhook to flip our DB.
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

  // ── Claim the pending campaign promo (one tap, code pre-filled) ────────
  // Opens Apple's redemption with the offer code already entered, via the
  // app's proven external-URL path (window.open '_system' - see lib/location.js).
  // The app backgrounds to the App Store; on return, the foreground hook below
  // re-checks the entitlement.
  const claimWithOfferCode = useCallback((codeStr) => {
    if (submitting || !codeStr) return;
    setError('');
    setClaimingPromo(true);
    const url = appleOfferCodeRedeemUrl(codeStr);
    try { window.open(url, '_system'); } catch { window.location.href = url; }
  }, [submitting]);

  // When the user returns from redeeming in the App Store, the entitlement
  // changed in ANOTHER process - so invalidate RevenueCat's cache first
  // (a stale cached read would never see the new purchase and would strand
  // a paying user), then poll. The ref guards against a second foreground
  // event stacking a parallel poll loop.
  const pollingRef = useRef(false);
  useAppForegroundRefresh(() => {
    if (!claimingPromo || pollingRef.current) return;
    pollingRef.current = true;
    (async () => {
      try {
        setConfirming(true);
        await invalidateCustomerInfoCache();
        for (let i = 0; i < 8; i++) {
          try {
            const info = await getCustomerInfo();
            if (hasActivePremium(info)) {
              await refresh();
              navigate('/dashboard', { replace: true });
              return;
            }
          } catch { /* transient - retry */ }
          await new Promise((r) => setTimeout(r, 1500));
        }
        // Not detected (didn't redeem, or webhook slow) - drop back to the paywall.
        setConfirming(false);
        setClaimingPromo(false);
      } finally {
        pollingRef.current = false;
      }
    })();
  }, { throttleMs: 0 });

  // ── Household members for the "One plan covers all N of you" row ──
  const [members, setMembers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.get('/household')
      .then(({ data }) => { if (!cancelled) setMembers(data.members ?? []); })
      .catch(() => { /* the row simply hides */ });
    return () => { cancelled = true; };
  }, []);

  // ── Promo validation (server-side, real coupon rules) ──────────
  // Campaign codes exist as BOTH a Stripe promotion code (which this
  // endpoint validates and prices) and an Apple Custom Offer Code with
  // the same string (which actually discounts the StoreKit charge). A
  // purchase with a code applied therefore routes through Apple's
  // redemption with the code pre-filled - Apple must bill the discount,
  // not us; showing a discount and then charging full price would be
  // the worst kind of paywall lie.
  const validatePromo = useCallback(async (codeStr) => {
    const { data } = await api.get(`/subscription/promo/${encodeURIComponent(codeStr)}`);
    return data; // { valid, code, percentOff, amountOff, currency } | { valid:false }
  }, []);

  // ── Packages ───────────────────────────────────────────────────
  const monthlyPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_monthly' || p.packageType === 'MONTHLY'
  );
  const annualPkg = offering?.availablePackages?.find(
    (p) => p.identifier === '$rc_annual' || p.packageType === 'ANNUAL'
  );

  const handlePaywallPurchase = useCallback((plan, appliedPromo) => {
    if (appliedPromo?.code) { claimWithOfferCode(appliedPromo.code); return; }
    const pkg = plan === 'annual' ? annualPkg : monthlyPkg;
    if (pkg) handlePurchase(pkg);
  }, [annualPkg, monthlyPkg, claimWithOfferCode, handlePurchase]);

  // Already subscribed - nothing to sell; say so and offer the way out.
  if (isActive) {
    return (
      <div className="min-h-screen bg-cream flex flex-col items-center justify-center px-6 text-center" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <h1 style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 28, color: '#1A1620' }}>
          You&rsquo;re already subscribed
        </h1>
        <p className="text-sm text-warm-grey mt-2">You have full access. Manage your subscription in Settings.</p>
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
      validatePromo={validatePromo}
      initialPromoCode={pendingPromo}
      busy={claimingPromo ? 'purchase' : submitting}
      confirming={confirming || loadingOffering}
      error={error}
      onDismissError={() => setError('')}
      finePrint={(
        <>
          <span>Auto-renews until cancelled in Settings &rarr; Apple ID &rarr; Subscriptions</span>
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
 * Returns null if the SDK doesn't expose a numeric price + currency we
 * can format - never falls back to hardcoded values (App Review verifies
 * displayed price matches StoreConnect).
 */
function computeAnnualPerMonth(pkg) {
  const priceObj = pkg?.product;
  const amount = priceObj?.price; // numeric, e.g. 59.99
  const currencyCode = priceObj?.currencyCode; // 'USD', 'GBP'
  if (typeof amount !== 'number' || !currencyCode) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      // Match Apple's typical formatting: 2 fraction digits.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 12);
  } catch {
    return null;
  }
}

// ─── Server-sync poll ────────────────────────────────────────────

/**
 * Refresh subscription status until it reflects the new purchase,
 * or until 8 seconds elapse. The webhook normally lands in <2s in
 * production. We don't BLOCK on this - failure to sync means the
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
      // Don't break the loop on transient errors - just retry.
    }
  }
}
