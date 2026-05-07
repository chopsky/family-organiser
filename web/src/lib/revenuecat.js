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
import { Purchases } from '@revenuecat/purchases-capacitor';

// Diagnostic: prove the module is being loaded at all on app launch.
console.log('[revenuecat] module loaded; isNative=', Capacitor.isNativePlatform(), 'platform=', Capacitor.getPlatform());

// Static import (was previously dynamic). The SDK is only useful on
// iOS native — on web/Android it returns a stub from registerPlugin
// that throws "UNIMPLEMENTED" when called. We gate every call site
// with isIapPlatform() so the stub never runs. The earlier dynamic
// import was hanging in the Capacitor WebView for reasons unclear;
// static imports are the documented Capacitor-plugin pattern anyway.

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
  console.log('[revenuecat] configure() entered');
  if (!isIapPlatform()) {
    console.log('[revenuecat] not iOS native, skipping');
    return;
  }
  if (_configured) {
    console.log('[revenuecat] already configured, skipping');
    return;
  }

  const apiKey = import.meta.env?.VITE_REVENUECAT_IOS_KEY;
  if (!apiKey) {
    console.warn(
      '[revenuecat] VITE_REVENUECAT_IOS_KEY not set — IAP disabled. ' +
      'Add the iOS public API key in Vercel env vars.'
    );
    return;
  }
  console.log('[revenuecat] api key present, length=', apiKey.length);

  try {
    console.log('[revenuecat] calling Purchases.configure...');
    await Purchases.configure({ apiKey });
    _configured = true;
    console.log('[revenuecat] configured ✓');
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

  try {
    console.log('[revenuecat] calling getOfferings...');
    const result = await Purchases.getOfferings();
    console.log('[revenuecat] getOfferings result:', JSON.stringify({
      hasCurrent: !!result?.current,
      currentId: result?.current?.identifier,
      currentPackageCount: result?.current?.availablePackages?.length || 0,
      allOfferingIds: Object.keys(result?.all || {}),
    }));
    if (!result?.current) {
      console.warn(
        '[revenuecat] No "current" offering set. Check RevenueCat dashboard → Offerings → ' +
        'mark one offering as "Current". All offerings: ' + Object.keys(result?.all || {}).join(', ')
      );
    }
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
