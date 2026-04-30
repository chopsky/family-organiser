/**
 * Trial indicator — Phase 4.
 *
 * Three visual variants keyed off `daysRemaining` from SubscriptionContext.
 * Only renders for trialing households; active/expired/internal return null.
 *
 * Variants follow the spec's day-by-day rules (§4):
 *   • Days 1–20 of trial  = 11+ days remaining  → subtle text
 *   • Days 21–25 of trial = 6–10 days remaining → dismissible card
 *   • Days 26–30 of trial = 1–5 days remaining  → non-dismissible card with usage stats
 *
 * We key the dismissal on today's date (YYYY-MM-DD). If the user dismisses
 * on day 22, we store "trial-dismissed:2026-05-13"; tomorrow that key no
 * longer matches today's date and the card reappears.
 */

import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSubscription } from '../context/SubscriptionContext';
import api from '../lib/api';
import { isIos } from '../lib/platform';

// ── localStorage helpers (mirror AuthContext's Safari-safe wrappers) ──
function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Safari private mode */ }
}
function todayYMD() {
  // London time — app is UK-first and trial date arithmetic should match
  // the time zone displayed in emails/UI (spec §6 "date formatting").
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}
const DISMISSED_KEY_PREFIX = 'trial-dismissed:';

/**
 * Format the trial end date as "21 May 2026" — matches the format we use
 * in emails (spec §6).
 */
function formatTrialEndDate(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/**
 * Subtle variant — one-line text for Settings "Plan" row.
 * Renders nothing when the user isn't trialing (covers active, expired,
 * internal, and not-yet-loaded states).
 */
export function TrialIndicatorSubtle({ className = '' }) {
  const { isTrialing, daysRemaining } = useSubscription();
  // App Store guideline 3.1.1: no trial/plan UI on iOS. The context
  // already short-circuits to isInternal=true on iOS so isTrialing
  // would naturally be false, but a defensive check here prevents
  // accidental regressions if the context behaviour ever changes.
  if (isIos()) return null;
  if (!isTrialing || daysRemaining == null) return null;

  const label = daysRemaining === 1
    ? 'Free trial · 1 day left'
    : `Free trial · ${daysRemaining} days left`;

  return (
    <span className={`text-sm font-medium text-plum ${className}`}>
      {label}
    </span>
  );
}

/**
 * Card variant — renders for days 6–10 remaining (dismissible) and
 * days 1–5 remaining (non-dismissible, with usage stats). Returns null
 * otherwise (trial days 1–20 show the subtle text in Settings instead).
 *
 * Intended to be dropped into the top of the Dashboard:
 *   <TrialIndicatorCard />
 */
export function TrialIndicatorCard() {
  const { isTrialing, daysRemaining, trialEndsAt } = useSubscription();

  // Dismiss state — keyed on today's date so the dismissal only lasts
  // until midnight in London time.
  const today = todayYMD();
  const dismissedKey = `${DISMISSED_KEY_PREFIX}${today}`;
  const [dismissed, setDismissed] = useState(() => safeGetItem(dismissedKey) === 'true');

  // Reset the dismissed flag when the date rolls over while the app is
  // open (rare but possible for someone who leaves a tab open overnight).
  useEffect(() => {
    if (safeGetItem(dismissedKey) === 'true') {
      setDismissed(true);
    } else {
      setDismissed(false);
    }
  }, [dismissedKey]);

  // App Store guideline 3.1.1: no trial/plan UI on iOS. The context
  // short-circuits isTrialing to false on iOS so the inWarningWindow
  // check below would already return null, but the explicit guard here
  // is defence-in-depth. Comes after the hook calls so we don't
  // violate rules-of-hooks.
  if (isIos()) return null;

  // Only show for the last 10 days of the trial. Days 1–20 of the trial
  // (11+ remaining) use the subtle text in Settings only per the spec.
  const inWarningWindow = isTrialing && daysRemaining != null && daysRemaining > 0 && daysRemaining <= 10;
  const isFinalPush = isTrialing && daysRemaining != null && daysRemaining > 0 && daysRemaining <= 5;

  if (!inWarningWindow) return null;
  if (!isFinalPush && dismissed) return null; // final-push card can't be dismissed

  return (
    <div
      className={
        'rounded-2xl p-5 mb-6 border ' +
        (isFinalPush
          ? 'bg-coral-light border-coral/30'   // higher-urgency final push
          : 'bg-plum-light border-plum/20')
      }
      role="region"
      aria-label="Free trial reminder"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          {isFinalPush ? (
            <FinalPushContent daysRemaining={daysRemaining} trialEndsAt={trialEndsAt} />
          ) : (
            <WarningContent daysRemaining={daysRemaining} />
          )}
        </div>

        {/* Dismissible only in the 6–10 day window. Final push (1–5 days)
            forces the user to acknowledge the end is near. */}
        {!isFinalPush && (
          <button
            type="button"
            onClick={() => {
              safeSetItem(dismissedKey, 'true');
              setDismissed(true);
            }}
            className="text-warm-grey hover:text-charcoal transition-colors p-1 -mt-1 -mr-1 shrink-0"
            aria-label="Dismiss until tomorrow"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Content variants ──────────────────────────────────────────────── */

function WarningContent({ daysRemaining }) {
  return (
    <>
      <h3 className="text-[17px] font-semibold text-charcoal" style={{ fontFamily: '"Instrument Serif", serif', letterSpacing: '-0.02em' }}>
        Your free trial ends in {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}
      </h3>
      <p className="text-sm text-warm-grey mt-1">
        Subscribe to keep all your Housemait features running for the family.
      </p>
      <div className="mt-3">
        <SubscribeButton />
      </div>
    </>
  );
}

function FinalPushContent({ daysRemaining, trialEndsAt }) {
  // Usage stats — fetched lazily so we only hit the endpoint for users
  // who actually see this card. If the fetch fails we fall back to a
  // generic line ("you've been busy…") rather than showing "loading" or
  // breaking the CTA.
  const [usage, setUsage] = useState(null);
  const [usageErrored, setUsageErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/household/usage-summary');
        if (!cancelled) setUsage(data);
      } catch {
        if (!cancelled) setUsageErrored(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const endDate = formatTrialEndDate(trialEndsAt);
  const summary = useMemo(() => buildUsageSentence(usage), [usage]);

  return (
    <>
      <h3 className="text-[17px] font-semibold text-charcoal" style={{ fontFamily: '"Instrument Serif", serif', letterSpacing: '-0.02em' }}>
        {daysRemaining === 1
          ? 'Your trial ends tomorrow'
          : `Your trial ends in ${daysRemaining} days`}
        {endDate ? ` · ${endDate}` : ''}
      </h3>
      <p className="text-sm text-charcoal/80 mt-1">
        {summary || (usageErrored
          ? "You've been busy — subscribe to keep your family's plans in one place."
          : 'Subscribe to keep everything running smoothly for your family.')}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <SubscribeButton variant="coral" />
        <Link to="/settings" className="text-sm font-medium text-plum hover:text-plum-pressed">
          Plan details
        </Link>
      </div>
    </>
  );
}

function SubscribeButton({ variant = 'plum' }) {
  // iOS: render a plain-text note instead of a Subscribe button (App
  // Store rules — no external payment entry points in the app).
  if (isIos()) {
    return (
      <p className="text-xs text-warm-grey italic">
        Subscribe on <span className="text-charcoal font-medium">housemait.com</span>
      </p>
    );
  }
  const bg = variant === 'coral'
    ? 'bg-coral hover:bg-coral/90'
    : 'bg-plum hover:bg-plum-pressed';
  return (
    <Link
      to="/subscribe"
      className={`inline-flex items-center px-4 py-2 rounded-xl text-white text-sm font-semibold transition-colors ${bg}`}
    >
      Subscribe
    </Link>
  );
}

/**
 * Build the personalised usage sentence. Picks the top 2–3 non-zero
 * dimensions to keep it from being noisy for families who only use
 * part of the app.
 */
function buildUsageSentence(usage) {
  if (!usage) return null;
  const parts = [];
  if (usage.shopping_item_count > 0) {
    parts.push(`${usage.shopping_item_count} shopping item${usage.shopping_item_count === 1 ? '' : 's'}`);
  }
  if (usage.meal_plan_count > 0) {
    parts.push(`${usage.meal_plan_count} meal${usage.meal_plan_count === 1 ? '' : 's'} planned`);
  }
  if (usage.task_count > 0) {
    parts.push(`${usage.task_count} task${usage.task_count === 1 ? '' : 's'}`);
  }
  if (usage.calendar_event_count > 0 && parts.length < 3) {
    parts.push(`${usage.calendar_event_count} calendar event${usage.calendar_event_count === 1 ? '' : 's'}`);
  }
  if (usage.document_count > 0 && parts.length < 3) {
    parts.push(`${usage.document_count} document${usage.document_count === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return null;

  // "X, Y, and Z" — natural joining
  const joined = parts.length === 1
    ? parts[0]
    : parts.length === 2
      ? `${parts[0]} and ${parts[1]}`
      : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;

  return `You've saved ${joined}. Subscribe to keep going.`;
}

// Default export = card variant (the most common use). Subtle is
// available as a named import for Settings.
export default TrialIndicatorCard;
