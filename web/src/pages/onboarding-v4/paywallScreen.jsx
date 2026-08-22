/**
 * Onboarding v4 - the subscription wall, iOS only.
 *
 * Sits at the very end of setup, at maximum investment: the household
 * exists, the calendar is connected, the kids are in. The trial starts
 * here as an Apple introductory offer, so the card is on file from day
 * one and the subscription renews by itself - the alternative was asking
 * a family to come back and pay on a random Tuesday two weeks later,
 * which almost nobody does.
 *
 * HARD by product decision (founder, 2026-08-21): there is no skip.
 *
 * But it fails OPEN, which is not the same as being skippable. If the
 * store can't be reached, has no offering configured, or the platform
 * doesn't do IAP at all, we let the household straight into the app on
 * the server-side trial rather than stranding someone who has just spent
 * five minutes setting up an account they now cannot open. A paywall
 * that can lock a paying customer out on a flaky train connection is
 * worse than one that occasionally lets someone through free - and App
 * Review hitting a sandbox glitch would be a rejection, not a bug report.
 *
 * Apple's requirements are all met on screen: price, duration, what
 * renews, Restore purchases, and links to Terms + Privacy.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { T, SHADOW, R } from './tokens';
import { Lockup, Cta, TOP_GAP } from './ui';
import { PAINS, PAINS_FALLBACK, WHATSAPP_BEN } from './content';
import { clearDraft, loadDraft } from '../../lib/onboardingDraft';
import {
  isIapPlatform, iapKeyPresent, configure, logIn,
  getCurrentOffering, purchasePackage, restorePurchases, hasActivePremium,
  getCustomerInfo,
} from '../../lib/revenuecat';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', color: T.ink, fontSize: 30, margin: '14px 0 0',
  textWrap: 'balance',
};
const SUB = { fontSize: 14.5, lineHeight: 1.45, color: T.ink2, margin: '10px 0 0', textWrap: 'pretty' };

/** "works out to £5.00 a month" from the annual package's numeric price.
 *  Computed from Apple's own localized pricing - never hardcoded (App
 *  Review checks displayed prices against App Store Connect). */
function annualPerMonth(pkg) {
  const amount = pkg?.product?.price;
  const currencyCode = pkg?.product?.currencyCode;
  if (typeof amount !== 'number' || !currencyCode) return null;
  try {
    const per = new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currencyCode,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount / 12);
    return `${per} a month`;
  } catch {
    return null;
  }
}

function PlanChoice({ label, price, per, badge, note, selected, onPick }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      style={{
        flex: 1, padding: '12px 10px', borderRadius: 14, cursor: 'pointer',
        border: selected ? `2px solid ${T.purple}` : `1.5px solid ${T.line2}`,
        background: selected ? T.purpleSoft : T.surface,
        textAlign: 'center', position: 'relative',
      }}
    >
      {badge && (
        <span style={{
          position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
          whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 99,
          background: T.okBg, color: T.okInk, font: '700 9.5px Inter, sans-serif',
          letterSpacing: '.05em', textTransform: 'uppercase',
        }}>
          {badge}
        </span>
      )}
      <span style={{ display: 'block', font: '600 13px Inter, sans-serif', color: T.ink }}>{label}</span>
      <span style={{ display: 'block', font: '700 15px Inter, sans-serif', color: T.ink, marginTop: 3 }}>{price}</span>
      <span style={{ display: 'block', fontSize: 11.5, color: T.ink3, marginTop: 1 }}>{per}</span>
      {note && <span style={{ display: 'block', fontSize: 10.5, color: T.okInk, marginTop: 2 }}>{note}</span>}
    </button>
  );
}

/**
 * Three reasons, in the family's own words. Screen 02 asked what hurts
 * and screen 03 promised to take it off their hands; this is the same
 * promise at the moment it costs money, which is when people actually
 * weigh it. Two of their picked pains (a recap, not the full list -
 * three rows still read as reasons, five read as a spec sheet), then
 * WhatsApp, always.
 */
function benefitsFor(pains) {
  const picked = (pains && pains.length ? pains : PAINS_FALLBACK)
    .map((id) => PAINS.find((p) => p.id === id))
    .filter(Boolean);
  const rows = picked.slice(0, 2).map((p) => ({ emoji: p.emoji, ...p.ben }));
  return [...rows, WHATSAPP_BEN];
}

/**
 * One line, not a second checklist: what they've just built is already
 * here. Degrades honestly - a family who skipped the optional steps is
 * told their household is ready, never that a calendar is connected
 * when it isn't.
 */
function setupLine(d) {
  const hasCal = Object.keys(d?.cals || {}).length > 0;
  if (hasCal && d?.wa) return 'Your calendar\u2019s connected and WhatsApp is set up. It\u2019s all waiting.';
  if (hasCal) return 'Your calendar\u2019s connected and the family\u2019s in. It\u2019s all waiting.';
  if (d?.wa) return 'WhatsApp is set up and the family\u2019s in. It\u2019s all waiting.';
  return 'Your household\u2019s created & ready. It\u2019s all waiting.';
}

/** "4 September" for the day an intro offer starting today would end. */
function trialEndLabel(introPeriod, introUnit) {
  if (!introPeriod || !introUnit) return null;
  const unit = String(introUnit).toUpperCase();
  const days = unit.startsWith('DAY') ? introPeriod
    : unit.startsWith('WEEK') ? introPeriod * 7
      : unit.startsWith('MONTH') ? introPeriod * 30
        : unit.startsWith('YEAR') ? introPeriod * 365 : 0;
  if (!days) return null;
  try {
    // Abbreviated month ("4 Sept", not "4 September") so the renewal
    // line stays on one line on a phone. Locale-aware: this is the
    // browser's own short form, so non-UK storefronts still read right.
    return new Date(Date.now() + days * 86400000)
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return null;
  }
}

/**
 * @param {string} householdId - identifies the purchase to RevenueCat.
 * @param {() => void} onDone - purchased, restored, or failed open.
 */
export default function PaywallScreen({ householdId, onDone, onSignOut }) {
  // Single exit: the onboarding draft has done its job by the time
  // anyone leaves this screen, whichever way they leave.
  const leave = () => { clearDraft(); onDone(); };
  // Both plans, monthly selected by default: leading with the annual
  // number alone made the first price anyone saw look like the only
  // price ("£59.99 sounds like a lot" - founder, first live test).
  const [pkgs, setPkgs] = useState({ monthly: null, annual: null });
  const [plan, setPlan] = useState('monthly');
  const [state, setState] = useState('loading'); // loading | ready | buying | restoring
  const [error, setError] = useState('');
  const pkg = pkgs[plan] || pkgs.monthly || pkgs.annual;
  // Read once: the pains they picked and what they connected. Kept
  // until they subscribe (see useOnboardingFlow.finish) so a
  // force-quit-and-reopen still gets the personalised wall.
  const [draft] = useState(() => loadDraft());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // iOS ONLY, explicitly (founder decision). Android is currently safe
      // by accident - VITE_REVENUECAT_GOOGLE_KEY isn't in the build, so
      // iapKeyPresent() is false there - but the day someone adds that key
      // for Play Billing, Android families would walk into a hard paywall
      // nobody decided to give them. Name the platform instead of relying
      // on an env var to stay absent.
      // Simulator escape. Xcode's Simulator can't complete a real
      // purchase without a StoreKit config, and a signed-out or
      // unsubscribed Apple ID has no entitlement to be waved through on -
      // so testing the FLOW meant being stuck at the wall every run.
      //
      // Build-time only, and never set in any build that ships: the flag
      // lives in web/.env.local, which .gitignore excludes (.env.*), so
      // it cannot be committed and a release build simply doesn't have
      // it. Loud on purpose - if this line ever appears in a TestFlight
      // console, the build was made wrong.
      if (import.meta.env?.VITE_PAYWALL_BYPASS === '1') {
        console.warn('[paywall] BYPASSED by VITE_PAYWALL_BYPASS - dev builds only');
        leave();
        return;
      }
      if (Capacitor.getPlatform() !== 'ios') { leave(); return; }
      // No IAP, or built without the key: nothing to sell, don't block.
      if (!isIapPlatform() || !iapKeyPresent()) { leave(); return; }
      try {
        await configure();
        if (householdId) await logIn(householdId);
        // Already subscribed - a resumed signup, a reinstall, or a second
        // device. Never show a wall to someone who is already paying.
        const existing = await getCustomerInfo();
        if (hasActivePremium(existing)) { leave(); return; }
        const offering = await getCurrentOffering();
        const all = offering?.availablePackages || [];
        // Same matching as IosSubscribe - RevenueCat's canonical package
        // identifiers first, packageType as the fallback.
        const monthly = all.find((p) => p.identifier === '$rc_monthly' || p.packageType === 'MONTHLY') || null;
        const annual = all.find((p) => p.identifier === '$rc_annual' || p.packageType === 'ANNUAL') || null;
        if (cancelled) return;
        if (!monthly && !annual && !all[0]) { leave(); return; } // nothing configured - fail open
        setPkgs({ monthly: monthly || all[0] || null, annual });
        setState('ready');
      } catch {
        if (!cancelled) leave(); // store unreachable - fail open
      }
    })();
    return () => { cancelled = true; };
  }, [householdId, onDone]);

  async function buy() {
    if (!pkg || state === 'buying') return;
    setError('');
    setState('buying');
    try {
      await purchasePackage(pkg);
      leave();
    } catch (err) {
      // A cancelled sheet is not an error to apologise for - the wall
      // simply stays put, which is what "hard" means.
      if (!err?.userCancelled) {
        setError('That didn’t go through. Try again, or restore a previous purchase.');
      }
      setState('ready');
    }
  }

  async function restore() {
    setError('');
    setState('restoring');
    try {
      const info = await restorePurchases();
      if (hasActivePremium(info)) { leave(); return; }
      setError('No previous subscription found on this Apple ID.');
    } catch {
      setError('Couldn’t reach the App Store just then. Try again in a moment.');
    }
    setState('ready');
  }

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100dvh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ ...SUB, opacity: 0.7 }}>One moment…</p>
      </div>
    );
  }

  // RevenueCat gives the localised price and, when an introductory offer
  // is configured, its duration - so the copy is never a hardcoded claim
  // that could drift from what StoreKit actually charges. (If a tester
  // sees $ instead of £, that's the SANDBOX ACCOUNT's storefront country,
  // not a bug - real users get their own storefront's currency.)
  const product = pkg?.product || {};
  const price = product.priceString || '';
  const isAnnual = plan === 'annual' && !!pkgs.annual;
  const period = isAnnual ? 'a year' : 'a month';
  const introPeriod = product.introPrice?.periodNumberOfUnits;
  const introUnit = product.introPrice?.periodUnit;
  const trialEnd = trialEndLabel(introPeriod, introUnit);
  const benefits = benefitsFor(draft.pains);
  const trialLabel = introPeriod && introUnit
    ? `${introPeriod} ${String(introUnit).toLowerCase()}${introPeriod > 1 ? 's' : ''} free`
    : null;

  return (
    <div style={{ minHeight: '100dvh', background: T.bg, padding: `${TOP_GAP} 22px 30px`, display: 'flex', flexDirection: 'column' }}>
      <Lockup width={104} />
      <div
        style={{
          background: T.surface, borderRadius: R.card || 22, padding: '24px 20px 20px',
          boxShadow: SHADOW.card, marginTop: 22, textAlign: 'center',
        }}
      >
        {trialLabel && (
          <span style={{
            display: 'inline-block', padding: '6px 13px', borderRadius: 99,
            background: T.okBg, color: T.okInk, font: '700 11.5px Inter, sans-serif',
            letterSpacing: '.07em', textTransform: 'uppercase',
          }}>
            {trialLabel}
          </span>
        )}
        <h1 style={H1}>That’s it all, <em style={{ fontStyle: 'normal', color: T.purple }}>out of your head.</em></h1>

        {/* Benefits lead, because the question at the moment money is
            involved is "what am I paying for?" - a recap of what they
            just set up answers the wrong question (founder, 2026-08-21). */}
        <div style={{ margin: '16px 0 0', textAlign: 'left' }}>
          {benefits.map((b) => (
            <div key={b.t} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', padding: '7px 0' }}>
              <span aria-hidden="true" style={{
                width: 30, height: 30, borderRadius: 9, background: T.purpleSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, flexShrink: 0,
              }}>{b.emoji}</span>
              <span>
                <span style={{ display: 'block', font: '600 14px Inter, sans-serif', color: T.ink }}>{b.t}</span>
                <span style={{ display: 'block', fontSize: 12.5, lineHeight: 1.35, color: T.ink3, marginTop: 1 }}>{b.d}</span>
              </span>
            </div>
          ))}
        </div>

        {/* One line, under a rule: what they built is already here. */}
        <p style={{
          margin: '13px 0 0', paddingTop: 12, borderTop: `1px solid ${T.line}`,
          fontSize: 12.5, lineHeight: 1.4, color: T.ink2, textAlign: 'left',
        }}>
          <span aria-hidden="true" style={{ color: T.okInk }}>✓</span> {setupLine(draft)}
        </p>

        {/* The fear that actually stops people at a hard wall is "will I
            forget and get charged?" - so answer it, with a date. */}
        {trialLabel && (
          <p style={{
            margin: '12px 0 0', padding: '8px 11px', borderRadius: 10,
            background: '#FBF1DE', color: '#8A5F1E', fontSize: 11.5, lineHeight: 1.4,
            textAlign: 'left',
          }}>
            {trialEnd ? `Free until ${trialEnd}. ` : `Free for ${trialLabel.replace(' free', '')}. `}
            We’ll remind you before it renews.
          </p>
        )}

        {/* Only one plan configured: the chooser can't render, so the
            price must still be stated somewhere. Apple requires it on the
            purchase screen, and without this the button would ask for
            money without ever naming it. */}
        {!(pkgs.monthly && pkgs.annual) && price && (
          <p style={{ margin: '14px 0 0', fontSize: 13.5, color: T.ink2 }}>
            {price} {period} for the whole household.
          </p>
        )}

        {pkgs.monthly && pkgs.annual && (
          <div style={{ display: 'flex', gap: 8, margin: '16px 0 0' }}>
            <PlanChoice
              label="Monthly"
              price={pkgs.monthly.product?.priceString}
              per="a month"
              selected={plan === 'monthly'}
              onPick={() => setPlan('monthly')}
            />
            <PlanChoice
              label="Annual"
              price={pkgs.annual.product?.priceString}
              per="a year"
              badge="2 months free"
              note={annualPerMonth(pkgs.annual)}
              selected={plan === 'annual'}
              onPick={() => setPlan('annual')}
            />
          </div>
        )}

        {error && (
          <p role="alert" style={{ fontSize: 13, lineHeight: 1.4, color: T.danger, margin: '14px 0 0' }}>{error}</p>
        )}

        <div style={{ marginTop: 18 }}>
          <Cta onClick={buy} disabled={state === 'buying' || state === 'restoring'}>
            {state === 'buying' ? 'One moment…' : (trialLabel ? 'Start my free trial' : 'Subscribe')}
          </Cta>
        </div>

        {/* Almost everyone who hesitates here has just spotted a typo in
            their household name. Nothing they'd want to change is locked -
            they simply can't know that from a screen with no way past it. */}
        <p style={{ fontSize: 12, lineHeight: 1.4, color: T.ink3, margin: '8px 0 0' }}>
          You can change any of this in Settings once you&rsquo;re in.
        </p>

        <button
          type="button"
          onClick={restore}
          disabled={state === 'buying' || state === 'restoring'}
          style={{
            width: '100%', minHeight: 40, marginTop: 8, border: 0, background: 'none',
            color: T.ink3, font: '600 13px Inter, sans-serif', cursor: 'pointer',
          }}
        >
          {state === 'restoring' ? 'Restoring…' : 'Restore purchases'}
        </button>

        {/* Always offered, from both the onboarding flow and the launch
            gate. A screen with literally no exit is hostile, and until
            this was passed through from onboarding too, force-quitting
            and reopening gave people MORE options than staying put. */}
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            style={{
              width: '100%', minHeight: 36, marginTop: 2, border: 0, background: 'none',
              color: T.ink3, font: '500 12.5px Inter, sans-serif', cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        )}

        {/* Apple requires the auto-renew terms and both policy links on the
            screen where the purchase is made. */}
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: T.ink3, margin: '12px 0 0' }}>
          {/* Guideline 3.1.2(c) wants the period length, the renewal terms
              and both policy links. It does NOT want them said twice -
              "auto-renewing" followed by "Renews automatically" was
              belt-and-braces that read as padding. */}
          {isAnnual ? '1 year subscription.' : '1 month subscription.'}{' '}
          Renews automatically unless cancelled at least 24 hours before the period
          ends. Manage or cancel in Settings &rsaquo; Apple ID &rsaquo; Subscriptions.{' '}
          <Link to="/terms" style={{ color: T.ink3, textDecoration: 'underline' }}>Terms of Use</Link>
          {' '}&middot;{' '}
          <Link to="/privacy" style={{ color: T.ink3, textDecoration: 'underline' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
