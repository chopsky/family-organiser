/**
 * Onboarding wizard shown to first-time users right after they create (or
 * join) a household. The backend sets users.onboarded_at when the flow
 * completes, and Login.jsx + SetupHousehold.jsx + RequireAuth all route
 * around that flag.
 *
 * Step list adapts to the platform - iOS gets a native push-permission
 * step; web doesn't. Every step is self-contained and receives the same
 * props so the shell can stay dumb.
 */

import { useState, useEffect, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import { isIos as isIosBrowser, APP_STORE_CONFIGURED } from '../lib/app-store';

const Welcome           = lazy(() => import('./onboarding/Welcome'));
const InviteFamily      = lazy(() => import('./onboarding/InviteFamily'));
const ConnectWhatsApp   = lazy(() => import('./onboarding/ConnectWhatsApp'));
// Calendar onboarding steps (ConnectCalendar / SubscribeCalendar) were
// removed from the wizard - both required technical input (OAuth dance
// or pasting an ICS URL) that mid-flow killed activation. The component
// files are still imported by Settings.jsx so they're not orphaned;
// Dashboard now surfaces a single nudge banner when no external feed
// exists, deferring the calendar setup to a moment the user chooses.
const Notifications     = lazy(() => import('./onboarding/Notifications'));
const GetApp            = lazy(() => import('./onboarding/GetApp'));
const Done              = lazy(() => import('./onboarding/Done'));

export default function Onboarding() {
  const { user, household, updateUser, logout } = useAuth();
  const navigate = useNavigate();

  // Escape hatch - without this users with a half-finished signup are
  // stuck: visiting housemait.com bounces them right back here via
  // RequireAuth's needsOnboarding redirect. Logging out clears the token
  // so the landing page renders normally. Hard redirect (vs navigate)
  // avoids a render race where the / route evaluates to Navigate('/dashboard')
  // before the new token=null state has propagated.
  function handleSignOut() {
    logout();
    window.location.href = '/';
  }
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState(false);

  const isIOS = Capacitor.getPlatform() === 'ios';

  // Push-permission status drives whether we include the Notifications
  // step. null = still checking (show a skeleton), 'granted' means the
  // step would be a pointless "✓ already on, click Continue" page - so
  // we skip it entirely. 'prompt' / 'denied' means there's a real ask
  // or message to deliver, step stays in.
  const [pushStatus, setPushStatus] = useState(isIOS ? null : 'skip');
  useEffect(() => {
    if (!isIOS) return;
    let cancelled = false;
    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.checkPermissions();
        if (!cancelled) setPushStatus(perm.receive || 'prompt');
      } catch {
        // If the check itself fails (rare - Capacitor plugin not ready),
        // include the step so the user can still attempt to enable.
        if (!cancelled) setPushStatus('prompt');
      }
    })();
    return () => { cancelled = true; };
  }, [isIOS]);

  // Build the step list from the cross-platform base + any platform-specific
  // inserts. Index-based navigation is fine because the list is built once
  // and doesn't change during the session.
  //
  // Step order matters - we put ConnectWhatsApp IMMEDIATELY after Welcome
  // because the central magic of Housemait is the WhatsApp bot. Earlier
  // versions had InviteFamily and Calendar steps gating WhatsApp, which
  // collapsed activation: a user signs up wanting to try the bot, gets
  // asked to invite their family + paste an iCal URL first, and bounces.
  // After this reorder the user goes Welcome → WhatsApp pairing → first
  // chat with the bot before any social or technical commitment.
  const includeNotifications = isIOS && pushStatus && pushStatus !== 'granted' && pushStatus !== 'skip';
  // "Get the app" nudge: only for someone finishing onboarding in a BROWSER
  // on an iPhone (isIosBrowser is UA-based, distinct from `isIOS` above which
  // is the native-Capacitor check). Hidden in the native app (already there),
  // on Android/desktop (no app / dead link), and if no live App Store listing.
  const includeGetApp = !isIOS && isIosBrowser() && APP_STORE_CONFIGURED;
  const steps = [
    { id: 'welcome',           Component: Welcome },
    { id: 'connect-whatsapp',  Component: ConnectWhatsApp },
    { id: 'invite-family',     Component: InviteFamily },
    ...(includeNotifications ? [{ id: 'notifications', Component: Notifications }] : []),
    ...(includeGetApp ? [{ id: 'get-app', Component: GetApp }] : []),
    { id: 'done',              Component: Done },
  ];

  // Guard: on iOS, the push-permission check is async. Until it resolves,
  // we don't yet know whether the Notifications step is in the list, so
  // rendering anything concrete could put stepIdx out of bounds if the
  // user tapped through fast. Show the skeleton in that sliver.
  const stillResolvingSteps = isIOS && pushStatus === null;
  const CurrentStep = stillResolvingSteps ? null : steps[stepIdx]?.Component;
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === steps.length - 1;
  const progressPct = ((stepIdx + 1) / steps.length) * 100;

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    try {
      const { data } = await api.post('/auth/mark-onboarded');
      if (data?.user) updateUser(data.user);
    } catch (err) {
      // Log but don't trap the user - they should still reach the dashboard
      // even if the server call hiccups. On next login they'd get bumped
      // back here, which isn't ideal but isn't broken either.
      console.error('[onboarding] mark-onboarded failed:', err?.response?.data?.error || err.message);
    } finally {
      navigate('/dashboard');
    }
  }

  function next() {
    if (isLast) finish();
    else setStepIdx((i) => i + 1);
  }
  function back() {
    if (!isFirst) setStepIdx((i) => i - 1);
  }

  return (
    <div
      // Concierge stage - matches Login.jsx + Signup.jsx so the visual
      // language stays consistent from sign-up through to the wizard's
      // final step. Radial gradient + two ambient blobs fill the
      // viewport, the card holds each step's content.
      className="relative min-h-screen overflow-hidden flex flex-col"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
      }}
    >
      {/* Decorative ambient blobs - aria-hidden because they're
          decorative-only, identical to the Login/Signup treatment. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          width: 760, height: 760, borderRadius: '50%',
          left: -180, bottom: -300,
          background: 'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)',
          filter: 'blur(20px)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          width: 600, height: 600, borderRadius: '50%',
          right: -160, top: -200,
          background: 'radial-gradient(circle, rgba(107,63,160,0.18) 0%, rgba(107,63,160,0) 70%)',
          filter: 'blur(20px)',
        }}
      />

      {/* Progress bar - thin strip at the very top of the stage,
          animates as the user advances. Sits above the blobs in
          stacking order so it stays crisp. */}
      <div
        className="relative z-10 h-1 safe-top"
        style={{ background: 'rgba(26, 22, 32, 0.08)' }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            background: 'var(--color-plum)',
          }}
        />
      </div>

      {/* Main content - glass card with the same look as the Login
          card. max-w-[420px] matches the Login/Signup card width so
          everything looks like one product. */}
      <main className="relative z-10 flex-1 flex items-start justify-center px-4 pt-10 pb-8 md:pt-12 md:pb-10">
        <div
          className="relative w-full max-w-[480px]"
          style={{
            background: 'rgba(255,253,250,0.86)',
            backdropFilter: 'blur(18px) saturate(140%)',
            WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.9)',
            borderRadius: 24,
            boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
            padding: '32px 28px 28px',
          }}
        >
          {/* Logomark in the same purple-tinted chip used by Login /
              Signup - kept here so every step inherits the same
              header without each step having to render its own. */}
          <div
            className="mx-auto mb-5"
            style={{
              width: 56, height: 56,
              borderRadius: 16,
              background: '#EFE9FB',
              border: '1px solid rgba(107,63,160,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            <img src="/housemait-logomark.svg" alt="" style={{ width: 34, height: 34, objectFit: 'contain' }} />
          </div>

          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <Suspense fallback={<StepSkeleton />}>
            {CurrentStep ? (
              <CurrentStep
                user={user}
                household={household}
                next={next}
                back={back}
                isFirst={isFirst}
                isLast={isLast}
                finishing={finishing}
                setError={setError}
              />
            ) : (
              <StepSkeleton />
            )}
          </Suspense>
        </div>
      </main>

      {/* Footer nav - Back / step counter / sign-out. Transparent
          over the stage; sits flush with the safe-area bottom. */}
      <footer className="relative z-10 safe-bottom">
        <div className="max-w-[480px] mx-auto px-5 py-4 flex items-center justify-between text-sm">
          {!isFirst ? (
            <button
              type="button"
              onClick={back}
              className="text-cocoa hover:text-bark transition-colors"
            >
              ← Back
            </button>
          ) : (
            <span />
          )}
          <span className="text-xs text-cocoa">
            Step {stepIdx + 1} of {steps.length}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs text-cocoa hover:text-bark transition-colors"
          >
            Sign out
          </button>
        </div>
      </footer>
    </div>
  );
}

function StepSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 bg-light-grey/40 rounded-lg w-2/3 mx-auto" />
      <div className="h-4 bg-light-grey/30 rounded w-full" />
      <div className="h-4 bg-light-grey/30 rounded w-5/6" />
      <div className="h-12 bg-light-grey/40 rounded-2xl w-full mt-6" />
    </div>
  );
}
