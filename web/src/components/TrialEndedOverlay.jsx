/**
 * Trial ended overlay - Phase 6.
 *
 * The modal that greets expired users on login. Non-dismissible in the
 * sense that it has no "X" button - the user must consciously click
 * either "Subscribe" or "Just browsing". Per the spec (§8) this is a
 * conversion lever: we remind them of the data they've built up, make
 * subscribing one click, and keep the "Just browsing" escape hatch as
 * a muted text link.
 *
 * Dismissal scope - the current browser session.
 *   • Keyed on a sessionStorage flag, so a fresh tab / new login shows
 *     the overlay again (matches "On login, show an overlay" in §8).
 *   • Reloads within the same tab keep the dismissal so users don't get
 *     nagged on every refresh.
 *
 * Mounted from Layout so it covers every authenticated in-app page (the
 * Subscribe / SubscribeSuccess / SubscribeCancel pages aren't wrapped
 * in Layout, so the overlay naturally doesn't appear there - exactly
 * what we want).
 */

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useSubscription } from '../context/SubscriptionContext';
import api from '../lib/api';
import { isAndroid } from '../lib/platform';

const DISMISSED_KEY = 'trial-ended-overlay-dismissed';
// The free-tier welcome is a one-time NOTICE, not a conversion wall, so
// its dismissal is per-device (localStorage) - a recurring "you're
// free!" modal would be a nag.
const FREE_NOTICE_KEY = 'free-tier-welcome-dismissed';

function safeSessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSessionSet(key, val) {
  try { sessionStorage.setItem(key, val); } catch { /* private mode */ }
}
function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* private mode */ }
}

export default function TrialEndedOverlay() {
  const { isExpired, isFreeTier, meter } = useSubscription();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(() => safeSessionGet(DISMISSED_KEY) === 'true');
  const [freeNoticeDismissed, setFreeNoticeDismissed] = useState(() => safeLocalGet(FREE_NOTICE_KEY) === 'true');
  const [usage, setUsage] = useState(null);

  // Fetch usage stats so the headline can personalise: "You've got 3
  // shopping lists, 12 meals saved…". Usage-summary is a GET so the
  // subscription gate lets it through even for expired households.
  // Skipped for the free-tier notice, which doesn't personalise.
  useEffect(() => {
    if (!isExpired || dismissed || isFreeTier) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/household/usage-summary');
        if (!cancelled) setUsage(data);
      } catch {
        // Non-fatal - the overlay renders without personalised numbers
        // if the fetch fails.
      }
    })();
    return () => { cancelled = true; };
  }, [isExpired, dismissed]);

  // Don't render anywhere near the subscribe flow itself. Belt-and-braces
  // with the Layout-scope already excluding those routes.
  if (location.pathname.startsWith('/subscription') || location.pathname === '/subscribe') {
    return null;
  }
  // iOS sees this now. The old guard predated StoreKit IAP, and its
  // claim that SubscriptionContext forces isExpired=false on iOS was
  // never true (the context has no platform special-casing at all), so
  // an iOS household whose trial ended simply hit 402s with no
  // explanation. The overlay's CTA goes to /subscribe, which on iOS is
  // the Apple paywall.
  // FREE_APP_MODE: a lapsed household is on the FREE tier, not locked
  // out - the legacy subscribe-or-browse wall would contradict an app
  // that works. Show the one-time welcome notice instead. It renders on
  // Android too (it's good news, not a payment prompt) - only the
  // upgrade link is suppressed there per Play payments policy.
  if (isFreeTier) {
    if (freeNoticeDismissed) return null;
    const used = meter?.used ?? null;
    const limit = meter?.limit ?? 10;
    const resetLabel = meter?.reset_label || 'the 1st';
    const dismissFree = () => {
      safeLocalSet(FREE_NOTICE_KEY, 'true');
      setFreeNoticeDismissed(true);
    };
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-tier-heading"
      >
        <div className="absolute inset-0 bg-charcoal/60 backdrop-blur-sm" aria-hidden="true" />
        <div className="relative bg-white rounded-2xl shadow-[0_8px_24px_rgba(107,63,160,0.10)] max-w-lg w-full p-7 md:p-8">
          <h2
            id="free-tier-heading"
            className="serif-display text-[28px] md:text-[32px] text-charcoal leading-tight mb-3"
            style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, letterSpacing: '-0.02em' }}
          >
            Housemait is now free for your family
          </h2>
          <p className="text-cocoa text-base">
            Your trial has ended, and the app keeps working - calendar, lists, meals,
            tasks and all the kids&rsquo; bits, free for good. Nothing has been deleted.
          </p>
          <p className="text-cocoa text-base mt-4">
            You can still use your assistant too, with{' '}
            <strong>{limit} free AI uses each month</strong> - texts, photos,
            voice notes and emails all count as one
            {used !== null ? ` (${Math.max(0, limit - used)} left right now)` : ''}. They reset on {resetLabel}.
            Daily briefs, connected calendars and new uploads are part of Premium.
          </p>
          <div className="mt-7 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={dismissFree}
              className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
            >
              Carry on free
            </button>
            {!isAndroid() && (
              <a
                href="/subscribe"
                className="text-sm font-medium text-warm-grey hover:text-charcoal transition-colors px-2 py-1"
              >
                Go unlimited with Premium
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Google Play payments policy: Android stays suppressed - no subscribe
  // prompt, no external-purchase steering - until Play Billing ships.
  if (isAndroid()) return null;
  if (!isExpired || dismissed) return null;

  function handleDismiss() {
    safeSessionSet(DISMISSED_KEY, 'true');
    setDismissed(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-ended-heading"
    >
      {/* Backdrop - slightly darker than the usual modal tint because
          this is a conversion moment, not a casual overlay. */}
      <div className="absolute inset-0 bg-charcoal/60 backdrop-blur-sm" aria-hidden="true" />

      <div className="relative bg-white rounded-2xl shadow-[0_8px_24px_rgba(107,63,160,0.10)] max-w-lg w-full p-7 md:p-8">
        <h2
          id="trial-ended-heading"
          className="serif-display text-[28px] md:text-[32px] text-charcoal leading-tight mb-3"
          style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, letterSpacing: '-0.02em' }}
        >
          Your free trial has ended
        </h2>

        <UsageSummary usage={usage} />

        <p className="text-cocoa text-base mt-5">
          Your data is safe - subscribe anytime to pick up right where you left off.
        </p>

        <div className="mt-7 flex items-center justify-between gap-3 flex-wrap">
          {/* One button for every platform: /subscribe dispatches to the
              Apple paywall on iOS and Stripe on web, so this is never an
              external payment link. */}
          <a
            href="/subscribe"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
          >
            Subscribe
          </a>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-sm font-medium text-warm-grey hover:text-charcoal transition-colors px-2 py-1"
          >
            Just browsing
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the personalised "You've got …" line. Picks up to three
 * non-zero dimensions so families who only use part of the app aren't
 * shown embarrassing zeroes.
 */
function UsageSummary({ usage }) {
  if (!usage) {
    // Graceful fallback while the stats load (or if the fetch fails).
    return (
      <p className="text-cocoa text-base">
        We hope Housemait's been useful for your household during your trial.
      </p>
    );
  }

  const parts = [];
  if (usage.shopping_list_count > 0) {
    parts.push(`${usage.shopping_list_count} shopping list${usage.shopping_list_count === 1 ? '' : 's'}`);
  }
  if (usage.meal_plan_count > 0) {
    parts.push(`${usage.meal_plan_count} meal${usage.meal_plan_count === 1 ? '' : 's'} saved`);
  }
  if (usage.calendar_event_count > 0 && parts.length < 3) {
    parts.push(`${usage.calendar_event_count} calendar event${usage.calendar_event_count === 1 ? '' : 's'}`);
  }
  if (usage.task_count > 0 && parts.length < 3) {
    parts.push(`${usage.task_count} task${usage.task_count === 1 ? '' : 's'}`);
  }
  if (usage.shopping_item_count > 0 && parts.length < 3) {
    parts.push(`${usage.shopping_item_count} shopping item${usage.shopping_item_count === 1 ? '' : 's'}`);
  }

  const memberPart = usage.member_count
    ? `Your family of ${usage.member_count} is all set up.`
    : '';

  if (parts.length === 0 && !memberPart) {
    return (
      <p className="text-cocoa text-base">
        We hope Housemait's been useful for your household.
      </p>
    );
  }

  const joined = parts.length === 0
    ? ''
    : parts.length === 1
      ? parts[0]
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;

  return (
    <div className="text-cocoa text-base space-y-1">
      {joined && <p>You've got {joined}.</p>}
      {memberPart && <p>{memberPart}</p>}
    </div>
  );
}
