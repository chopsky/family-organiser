/**
 * Subscribe page — Phase 5.
 *
 * Shows monthly + annual pricing cards and kicks off Stripe Checkout for
 * the chosen plan. Annual is visually highlighted as the recommendation
 * per the spec ("Pre-selects the Annual option" / "Best value"); Monthly
 * uses a secondary button. Each card has its own Subscribe button — no
 * separate "confirm selection" step.
 *
 * Reachable three ways:
 *   1. Direct navigation (/subscribe link)
 *   2. Redirect from the 402 interceptor when an expired household tries
 *      to mutate (see web/src/lib/api.js + SubscriptionContext)
 *   3. The TrialIndicatorCard's "Subscribe" button on the Dashboard
 *
 * Does NOT require the user to be expired — active users can still see
 * it (e.g. if they want to switch plans, though the Customer Portal is
 * the right tool for that — we nudge them there via a text link).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useSubscription } from '../context/SubscriptionContext';
import ErrorBanner from '../components/ErrorBanner';
import { isIos } from '../lib/platform';

// Pricing constants — hard-coded in the UI layer because Stripe is the
// source of truth on the backend, but users see these numbers BEFORE we
// hit Stripe. If you ever change the price in Stripe, update here too.
// (A future refinement would fetch these from the backend, which in turn
// reads them from Stripe's price objects at boot.)
const PLANS = {
  monthly: {
    label: 'Monthly',
    priceDisplay: '£4.99',
    periodDisplay: 'per month',
    tagline: 'Pay as you go, cancel anytime.',
  },
  annual: {
    label: 'Annual',
    priceDisplay: '£49',
    periodDisplay: 'per year',
    tagline: "That's just £4.08 a month.",
    badge: 'Best value',
    savings: 'Save £10.88 · 2 months free',
  },
};

export default function Subscribe() {
  const navigate = useNavigate();
  const { isActive, isTrialing, isExpired, daysRemaining, trialEndsAt, plan: currentPlan } = useSubscription();
  const [submitting, setSubmitting] = useState(null); // 'monthly' | 'annual' | null
  const [error, setError] = useState('');

  // iOS: Apple Review Guideline 3.1.1 bars selling digital subscriptions
  // without using Apple's IAP, and the Anti-Steering rule bars linking to
  // an external payment page. We therefore render a plain info screen on
  // iOS — no pricing, no buttons pointing at Stripe, just a note pointing
  // users at the web app (plain text, not a link).
  if (isIos()) {
    return <IosSubscribeInfo navigate={navigate} />;
  }

  async function handleSubscribe(plan) {
    if (submitting) return;
    setSubmitting(plan);
    setError('');
    try {
      const { data } = await api.post('/subscription/checkout', { plan });
      if (!data?.url) {
        throw new Error('Checkout URL missing from response');
      }
      // Full-page redirect to Stripe's hosted checkout. Using
      // window.location instead of navigate() because Stripe Checkout is
      // a completely different origin.
      window.location.href = data.url;
    } catch (err) {
      console.error('[Subscribe] checkout failed:', err);
      setError(
        err.response?.data?.error ||
          'Could not start checkout. Please try again in a moment.'
      );
      setSubmitting(null);
    }
  }

  // Contextual headline / subhead that tells the user WHY they're on
  // this page. Rendered inline below.
  const copy = buildCopy({ isExpired, isTrialing, isActive, daysRemaining, currentPlan });

  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-warm-grey hover:text-charcoal transition-colors mb-6 flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="text-center mb-10">
          <h1
            className="text-[36px] md:text-[48px] leading-[1.05] tracking-[-0.02em] text-charcoal mb-3"
            style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600 }}
          >
            {copy.headline}
          </h1>
          <p className="text-cocoa text-base max-w-xl mx-auto">
            {copy.subhead}
          </p>
        </div>

        <ErrorBanner message={error} onDismiss={() => setError('')} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <PricingCard
            plan="monthly"
            highlighted={false}
            currentPlan={currentPlan}
            submitting={submitting === 'monthly'}
            disabled={submitting !== null}
            onSubscribe={() => handleSubscribe('monthly')}
          />
          <PricingCard
            plan="annual"
            highlighted={true}
            currentPlan={currentPlan}
            submitting={submitting === 'annual'}
            disabled={submitting !== null}
            onSubscribe={() => handleSubscribe('annual')}
          />
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs text-warm-grey">
            Secure checkout powered by Stripe. Cancel anytime from Settings.<br />
            {isTrialing && trialEndsAt && (
              <span>
                Your free trial runs until{' '}
                {new Intl.DateTimeFormat('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'Europe/London',
                }).format(new Date(trialEndsAt))}
                .
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function buildCopy({ isExpired, isTrialing, isActive, daysRemaining, currentPlan }) {
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
          : 'Any time before your trial ends, you can switch to a paid plan with no gap.',
    };
  }
  if (isActive) {
    return {
      headline: "You're already subscribed",
      subhead: currentPlan
        ? `You're on the ${currentPlan === 'annual' ? 'annual' : 'monthly'} plan. To switch plans or update your card, use the Customer Portal from Settings.`
        : 'Manage your subscription from Settings.',
    };
  }
  return {
    headline: 'Subscribe to Housemait',
    subhead: 'One subscription covers your whole household.',
  };
}

function PricingCard({ plan, highlighted, currentPlan, submitting, disabled, onSubscribe }) {
  const p = PLANS[plan];
  const isCurrentPlan = currentPlan === plan;

  return (
    <div
      className={
        'relative rounded-2xl p-6 md:p-7 transition-shadow ' +
        (highlighted
          ? 'bg-white border-2 border-plum shadow-[0_8px_24px_rgba(107,63,160,0.10)]'
          : 'bg-white border border-light-grey shadow-[0_2px_8px_rgba(107,63,160,0.06)]')
      }
    >
      {p.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-coral text-white text-xs font-semibold px-3 py-1 rounded-full">
          {p.badge}
        </div>
      )}

      <h2
        className="text-[22px] text-charcoal mb-1"
        style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em' }}
      >
        {p.label}
      </h2>
      <p className="text-sm text-warm-grey mb-5">{p.tagline}</p>

      <div className="mb-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[36px] font-semibold text-charcoal leading-none" style={{ fontFamily: 'Lora, Georgia, serif' }}>
            {p.priceDisplay}
          </span>
          <span className="text-sm text-warm-grey">{p.periodDisplay}</span>
        </div>
        {p.savings && (
          <p className="text-sm font-semibold text-coral mt-2">{p.savings}</p>
        )}
      </div>

      <ul className="space-y-2 mb-6 text-sm text-charcoal">
        {[
          'Unlimited shopping lists',
          'Shared family calendar',
          'Meal planning & recipes',
          'Receipt scanning',
          'WhatsApp assistant',
          'Document storage',
        ].map((feature) => (
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
        onClick={onSubscribe}
        disabled={disabled || isCurrentPlan}
        className={
          'w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ' +
          (highlighted
            ? 'bg-plum hover:bg-plum-pressed text-white'
            : 'bg-white border-[1.5px] border-plum text-plum hover:bg-plum-light')
        }
      >
        {isCurrentPlan
          ? 'Current plan'
          : submitting
            ? 'Starting checkout…'
            : `Subscribe — ${p.priceDisplay}/${plan === 'monthly' ? 'mo' : 'yr'}`}
      </button>
    </div>
  );
}

/**
 * iOS-only rendering of the Subscribe route. Intentionally contains no
 * pricing, no buttons pointing at external payment pages, and no tappable
 * links to housemait.com — all three would trigger App Store review
 * rejection under Guideline 3.1.1 and the Anti-Steering rule.
 *
 * The URL is surfaced as plain text so a user who decides to subscribe
 * knows where to go (they can type it manually into Safari). The Back
 * button uses React Router navigation only — stays inside the app.
 */
function IosSubscribeInfo({ navigate }) {
  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <div className="max-w-lg mx-auto">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-warm-grey hover:text-charcoal transition-colors mb-6 flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(107,63,160,0.06)] border border-cream-border p-7 md:p-8">
          <h1
            className="text-[26px] text-charcoal mb-3"
            style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            Manage your subscription on the web
          </h1>
          <p className="text-cocoa text-base leading-relaxed mb-4">
            Housemait subscriptions are managed on our website rather than in the app.
          </p>
          <p className="text-cocoa text-base leading-relaxed mb-6">
            Open a web browser on any device and go to <strong className="text-charcoal">housemait.com</strong> to start, change, or cancel your subscription. Your account and household data stay in sync — sign in with the same email and you'll pick up right where you left off here.
          </p>

          <div className="bg-oat rounded-xl px-4 py-3 mb-2">
            <p className="text-sm text-charcoal font-medium mb-1">What you can still do here</p>
            <ul className="text-sm text-cocoa space-y-1 list-disc list-inside">
              <li>Use every feature during your free trial</li>
              <li>View your current plan status in Settings</li>
              <li>Access your household's lists, calendar, meals and more</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
