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
  const [pkg, setPkg] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | buying | restoring
  const [error, setError] = useState('');

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
        const first = offering?.availablePackages?.[0] || null;
        if (cancelled) return;
        if (!first) { onDone(); return; } // no offering configured - fail open
        setPkg(first);
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
  // that could drift from what StoreKit actually charges.
  const product = pkg?.product || {};
  const price = product.priceString || '';
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
            ? `Start with ${trialLabel}. After that it’s ${price} for the whole household, and you can cancel any time.`
            : `${price} for the whole household. Cancel any time.`}
        </p>

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
          Subscriptions renew automatically unless cancelled at least 24 hours before the period
          ends. Manage or cancel in Settings &rsaquo; Apple ID &rsaquo; Subscriptions.{' '}
          <Link to="/terms" style={{ color: T.ink3, textDecoration: 'underline' }}>Terms of Use</Link>
          {' '}&middot;{' '}
          <Link to="/privacy" style={{ color: T.ink3, textDecoration: 'underline' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
