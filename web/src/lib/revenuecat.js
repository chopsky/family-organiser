/**
 * RevenueCat client wrapper — IAP Phase 2b.
 *
 * Thin layer over @revenuecat/purchases-capacitor that:
 *
 *   1. Centralises the iOS-only check so callers don't have to
 *      remember to gate every call. Every export is a no-op on web
 *      and Android (Capacitor.isNativePlatform() === false), which
 *      lets the rest of the app call into it unconditionally.
 *
 *   2. Hides the SDK's verbose response shapes — callers want
 *      "did the purchase succeed" or "what's the active entitlement",
 *      not the full CustomerInfo blob.
 *
 *   3. Survives missing config gracefully. If VITE_REVENUECAT_IOS_KEY
 *      isn't set (e.g. a developer running the iOS app pointed at a
 *      local backend without the env var), every call no-ops and
 *      logs a warning rather than crashing the app.
 *
 * Lifecycle:
 *
 *   - configure() runs once at app boot from main.jsx. Idempotent.
 *   - logIn(householdId) runs after a successful auth (or on
 *     app-restart restore from localStorage) so the SDK's app_user_id
 *     equals our households.id — that's what the webhook resolver
 *     expects (see src/routes/revenuecat-webhook.js#resolveHousehold).
 *   - logOut() runs on user logout to clear the SDK's identity.
 *   - getOfferings() / purchasePackage() / restorePurchases() power
 *     the IosSubscribe paywall component.
 *
 * The "premium" entitlement identifier matches what we configured in
 * RevenueCat (see Phase 0 setup). If the entitlement key is renamed
 * in the dashboard, update PREMIUM_ENTITLEMENT here too.
 */

import { Capacitor } from '@capacitor/core';

// Lazy-load the SDK module so non-native builds don't bundle native
// stubs they'll never call. Vite still bundles it (no top-level
// dynamic-import elision in v8), but the import is cheap on iOS where
// it's actually needed. The dynamic import also gives us a clean
// failure path if the native module isn't registered for some reason
// (e.g. cap sync didn't run before a build).
let _purchasesPromise = null;
async function getPurchases() {
  if (!Capacitor.isNativePlatform()) return null;
  if (!_purchasesPromise) {
    _purchasesPromise = import('@revenuecat/purchases-capacitor')
      .then((mod) => mod.Purchases)
      .catch((err) => {
        console.error('[revenuecat] failed to load native module:', err);
        _purchasesPromise = null;
        return null;
      });
  }
  return _purchasesPromise;
}

/** Entitlement identifier matching the RevenueCat dashboard (Phase 0). */
export const PREMIUM_ENTITLEMENT = 'premium';

/** True if we're running on a platform where IAP is even possible. */
export function isIapPlatform() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
}

let _configured = false;

/**
 * Initialise the RevenueCat SDK. Idempotent — safe to call multiple
 * times (subsequent calls are no-ops). Should run as early as possible
 * in the app lifecycle (main.jsx), BEFORE any logIn/getOfferings call.
 *
 * No-op on web. No-op when VITE_REVENUECAT_IOS_KEY isn't set (with a
 * console warning so dev builds get a clear hint).
 */
export async function configure() {
  if (!isIapPlatform()) return;
  if (_configured) return;

  const apiKey = import.meta.env?.VITE_REVENUECAT_IOS_KEY;
  if (!apiKey) {
    console.warn(
      '[revenuecat] VITE_REVENUECAT_IOS_KEY not set — IAP disabled. ' +
      'Add the iOS public API key in Vercel env vars.'
    );
    return;
  }

  const Purchases = await getPurchases();
  if (!Purchases) return;

  try {
    await Purchases.configure({ apiKey });
    _configured = true;
    console.log('[revenuecat] configured');
  } catch (err) {
    console.error('[revenuecat] configure failed:', err);
  }
}

/**
 * Tell RevenueCat the current user's identifier (our household.id).
 * Subsequent purchases / webhook events will carry this as
 * app_user_id, which our webhook handler resolves directly to a
 * household row.
 *
 * Safe to call even if configure() failed — the SDK will buffer the
 * call until/unless configure succeeds.
 */
export async function logIn(householdId) {
  if (!isIapPlatform() || !householdId) return;
  const Purchases = await getPurchases();
  if (!Purchases) return;

  try {
    await Purchases.logIn({ appUserID: householdId });
  } catch (err) {
    // Non-fatal: a logIn failure means RevenueCat will fall back to
    // an anonymous $RCAnonymousID, and our webhook will fall back to
    // findHouseholdByRevenuecatAppUserId via the SUBSCRIBER_ALIAS
    // event. Log for visibility but don't disrupt the app.
    console.error('[revenuecat] logIn failed:', err);
  }
}

/**
 * Clear RevenueCat's identity. Called from AuthContext on logout so
 * the next user on this device doesn't inherit the previous user's
 * subscription state.
 */
export async function logOut() {
  if (!isIapPlatform()) return;
  const Purchases = await getPurchases();
  if (!Purchases) return;

  try {
    await Purchases.logOut();
  } catch (err) {
    // Calling logOut while already anonymous is fine — RevenueCat
    // throws a specific error code we can ignore. Log other errors.
    if (err?.code !== '22' /* PURCHASES_ERROR_OPERATION_ALREADY_IN_PROGRESS */) {
      console.error('[revenuecat] logOut failed:', err);
    }
  }
}

/**
 * Fetch the current "offering" — the bundle of packages we want to
 * sell on iOS. Returns the offering tagged "Current" in RevenueCat
 * (Phase 0 setup: a `default` offering with Monthly + Annual packages).
 *
 * Returns null on non-iOS, on misconfiguration, or when no offering is
 * marked current. Components handle null by showing an error / fallback.
 */
export async function getCurrentOffering() {
  if (!isIapPlatform()) return null;
  const Purchases = await getPurchases();
  if (!Purchases) return null;

  try {
    const result = await Purchases.getOfferings();
    return result?.current || null;
  } catch (err) {
    console.error('[revenuecat] getOfferings failed:', err);
    return null;
  }
}

/**
 * Trigger the Apple purchase sheet for the given package. Returns the
 * updated CustomerInfo on success (so callers can read the new
 * entitlement state immediately, before our webhook lands).
 *
 * Throws on user-cancel (so the caller can distinguish cancel from
 * failure with try/catch + err.userCancelled). Other errors propagate.
 */
export async function purchasePackage(pkg) {
  if (!isIapPlatform()) {
    throw new Error('IAP not available on this platform');
  }
  const Purchases = await getPurchases();
  if (!Purchases) {
    throw new Error('RevenueCat SDK not loaded');
  }

  // Purchases.purchasePackage returns { customerInfo, productIdentifier, transaction }.
  return Purchases.purchasePackage({ aPackage: pkg });
}

/**
 * Re-sync the user's purchases from Apple. Required by App Review
 * Guideline 3.1.1 — every paid app must offer a "Restore Purchases"
 * button so users on a new device / fresh install can recover access
 * without paying twice.
 *
 * Returns the refreshed CustomerInfo (entitlements live under
 * .entitlements.active by identifier).
 */
export async function restorePurchases() {
  if (!isIapPlatform()) {
    throw new Error('Restore not available on this platform');
  }
  const Purchases = await getPurchases();
  if (!Purchases) {
    throw new Error('RevenueCat SDK not loaded');
  }

  return Purchases.restorePurchases();
}

/**
 * Return RevenueCat's current view of the user's entitlement state.
 * Useful as a fast-path on app launch — if the SDK already has cached
 * state from a recent purchase, we can mark the user active locally
 * before the server's `/subscription/status` call resolves.
 */
export async function getCustomerInfo() {
  if (!isIapPlatform()) return null;
  const Purchases = await getPurchases();
  if (!Purchases) return null;

  try {
    const result = await Purchases.getCustomerInfo();
    return result?.customerInfo || null;
  } catch (err) {
    console.error('[revenuecat] getCustomerInfo failed:', err);
    return null;
  }
}

/**
 * True if the cached CustomerInfo carries an active "premium"
 * entitlement. Cheap helper for UI decisions ("show paywall vs.
 * dashboard") without re-hitting RevenueCat.
 */
export function hasActivePremium(customerInfo) {
  if (!customerInfo) return false;
  return Boolean(customerInfo?.entitlements?.active?.[PREMIUM_ENTITLEMENT]);
}
