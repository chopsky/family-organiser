/**
 * Onboarding wizard shown to first-time users right after they create (or
 * join) a household. The backend sets users.onboarded_at when the flow
 * completes, and Login.jsx + SetupHousehold.jsx + RequireAuth all route
 * around that flag.
 *
 * Step list adapts to the platform — iOS gets a native push-permission
 * step; web doesn't. Every step is self-contained and receives the same
 * props so the shell can stay dumb.
 */

import { useState, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';

const Welcome          = lazy(() => import('./onboarding/Welcome'));
const InviteFamily     = lazy(() => import('./onboarding/InviteFamily'));
const ConnectWhatsApp  = lazy(() => import('./onboarding/ConnectWhatsApp'));
const Notifications    = lazy(() => import('./onboarding/Notifications'));
const Done             = lazy(() => import('./onboarding/Done'));

export default function Onboarding() {
  const { user, household, updateUser } = useAuth();
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState(false);

  const isIOS = Capacitor.getPlatform() === 'ios';

  // Build the step list from the cross-platform base + any platform-specific
  // inserts. Index-based navigation is fine because the list is built once
  // and doesn't change during the session.
  const steps = [
    { id: 'welcome',           Component: Welcome },
    { id: 'invite-family',     Component: InviteFamily },
    { id: 'connect-whatsapp',  Component: ConnectWhatsApp },
    // Calendar sync intentionally isn't a wizard step — OAuth redirects
    // away from the app for Google/Microsoft, and there's no good way to
    // inline that without risking wizard progress. Users discover it from
    // Settings once they reach the dashboard.
    ...(isIOS ? [{ id: 'notifications', Component: Notifications }] : []),
    { id: 'done',              Component: Done },
  ];

  const CurrentStep = steps[stepIdx].Component;
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
      // Log but don't trap the user — they should still reach the dashboard
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
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-cream)' }}>
      {/* Progress bar — thin strip at the very top, animates as you advance */}
      <div
        className="sticky top-0 z-10 h-1"
        style={{ background: 'var(--color-light-grey)' }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            background: 'var(--color-plum)',
          }}
        />
      </div>

      <main className="flex-1 flex items-start justify-center px-5 pt-12 pb-8 md:pt-20 md:pb-16">
        <div className="w-full max-w-xl">
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <Suspense fallback={<StepSkeleton />}>
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
          </Suspense>
        </div>
      </main>

      {/* Footer nav — back + step counter. "Next" / "Skip" buttons live
          inside each step so they can control their own wording. */}
      <footer className="border-t border-light-grey bg-white/60 backdrop-blur-sm">
        <div className="max-w-xl mx-auto px-5 py-4 flex items-center justify-between text-sm">
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
