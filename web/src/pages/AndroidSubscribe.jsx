/**
 * AndroidSubscribe - the /subscribe destination on the native Android app.
 *
 * Google Play's payments policy requires Google Play Billing for digital
 * subscriptions purchased inside an app distributed on Play, and (like
 * Apple's anti-steering rule) prohibits directing users to an external
 * payment flow. Until Play Billing ships (RevenueCat, mirroring the iOS
 * IAP integration), the Android build offers NO purchase flow:
 *
 *   - no Subscribe CTAs anywhere in the Android app (see the isAndroid()
 *     guards in TrialIndicator / TrialEndedOverlay / SubscribePrompt /
 *     Settings / Dashboard's PromoClaimNudge),
 *   - this page shows a neutral notice with no external link and no
 *     instruction on where to purchase.
 *
 * A household whose subscription was bought elsewhere (web Stripe or iOS
 * IAP) is entitled account-wide, so Android members of a subscribed
 * household are unaffected.
 */

import { useNavigate } from 'react-router-dom';

export default function AndroidSubscribe() {
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
