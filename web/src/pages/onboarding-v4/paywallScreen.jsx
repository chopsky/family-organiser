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

const BENEFITS = [
  'Everything in Housemait, for the whole household',
  'School term dates and clubs on the family calendar',
  'The WhatsApp assistant that does the typing',
  'Kids get their own space, with chores and rewards',
];

/**
 * @param {string} householdId - identifies the purchase to RevenueCat.
 * @param {() => void} onDone - purchased, restored, or failed open.
 */
export default function PaywallScreen({ householdId, onDone }) {
  // Both plans, monthly selected by default: leading with the annual
  // number alone made the first price anyone saw look like the only
  // price ("£59.99 sounds like a lot" - founder, first live test).
  const [pkgs, setPkgs] = useState({ monthly: null, annual: null });
  const [plan, setPlan] = useState('monthly');
  const [state, setState] = useState('loading'); // loading | ready | buying | restoring
  const [error, setError] = useState('');
  const pkg = pkgs[plan] || pkgs.monthly || pkgs.annual;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // iOS ONLY, explicitly (founder decision). Android is currently safe
      // by accident - VITE_REVENUECAT_GOOGLE_KEY isn't in the build, so
      // iapKeyPresent() is false there - but the day someone adds that key
      // for Play Billing, Android families would walk into a hard paywall
      // nobody decided to give them. Name the platform instead of relying
      // on an env var to stay absent.
      if (Capacitor.getPlatform() !== 'ios') { onDone(); return; }
      // No IAP, or built without the key: nothing to sell, don't block.
      if (!isIapPlatform() || !iapKeyPresent()) { onDone(); return; }
      try {
        await configure();
        if (householdId) await logIn(householdId);
        // Already subscribed - a resumed signup, a reinstall, or a second
        // device. Never show a wall to someone who is already paying.
        const existing = await getCustomerInfo();
        if (hasActivePremium(existing)) { onDone(); return; }
        const offering = await getCurrentOffering();
        const all = offering?.availablePackages || [];
        // Same matching as IosSubscribe - RevenueCat's canonical package
        // identifiers first, packageType as the fallback.
        const monthly = all.find((p) => p.identifier === '$rc_monthly' || p.packageType === 'MONTHLY') || null;
        const annual = all.find((p) => p.identifier === '$rc_annual' || p.packageType === 'ANNUAL') || null;
        if (cancelled) return;
        if (!monthly && !annual && !all[0]) { onDone(); return; } // nothing configured - fail open
        setPkgs({ monthly: monthly || all[0] || null, annual });
        setState('ready');
      } catch {
        if (!cancelled) onDone(); // store unreachable - fail open
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
      onDone();
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
      if (hasActivePremium(info)) { onDone(); return; }
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
        <h1 style={H1}>Your family, all in one place.</h1>
        <p style={SUB}>
          {trialLabel
            ? `Start with ${trialLabel}. After that it’s ${price} ${period} for the whole household, and you can cancel any time.`
            : `${price} ${period} for the whole household. Cancel any time.`}
        </p>

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

        <div style={{ margin: '18px 0 0', textAlign: 'left' }}>
          {BENEFITS.map((b) => (
            <div key={b} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0' }}>
              <span aria-hidden="true" style={{
                width: 18, height: 18, borderRadius: '50%', background: T.okBg, color: T.okInk,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 1,
              }}>✓</span>
              <span style={{ fontSize: 14, lineHeight: 1.4, color: T.ink2 }}>{b}</span>
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" style={{ fontSize: 13, lineHeight: 1.4, color: T.danger, margin: '14px 0 0' }}>{error}</p>
        )}

        <div style={{ marginTop: 18 }}>
          <Cta onClick={buy} disabled={state === 'buying' || state === 'restoring'}>
            {state === 'buying' ? 'One moment…' : (trialLabel ? 'Start my free trial' : 'Subscribe')}
          </Cta>
        </div>

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

        {/* Apple requires the auto-renew terms and both policy links on the
            screen where the purchase is made. */}
        <p style={{ fontSize: 11.5, lineHeight: 1.5, color: T.ink3, margin: '12px 0 0' }}>
          {isAnnual ? '1 year subscription, auto-renewing.' : '1 month subscription, auto-renewing.'}{' '}
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
