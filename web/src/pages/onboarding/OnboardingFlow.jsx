/**
 * OnboardingFlow - the single continuous new-user flow (rebuilt from the
 * design_handoff_onboarding prototype). Nine linear steps spanning the auth
 * boundary in ONE mounted component:
 *
 *   1 welcome   2 heaviest   3 plan      (pre-auth, local state)
 *   4 account                            (creates the account)
 *   5 household 6 invite  7 whatsapp  8 calendar  9 finish  (authenticated)
 *
 * Google SSO is a popup (no full-page redirect), so the flow stays mounted
 * through account creation and continues in place. The email path pauses at
 * "check your inbox"; after verifying, the auth gate funnels the user back to
 * /start and `entryStep()` resumes them at the right step.
 *
 * Visual language reuses the existing concierge stage (gradient + ambient blobs
 * + glass card) from Onboarding.jsx / Login.jsx, in our plum tokens. No new
 * background. British English, no em dashes, prefers-reduced-motion honoured.
 */
import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import ErrorBanner from '../../components/ErrorBanner';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';

// Instrument Serif is loaded app-wide (web/index.html); apply it inline so the
// flow doesn't depend on the page-scoped .serif class from landing.css.
const SERIF = "'Instrument Serif', serif";

// Step keys in order + the progress-bar fill per step (mirrors the prototype).
const STEPS = ['welcome', 'heaviest', 'plan', 'account', 'household', 'invite', 'whatsapp', 'calendar', 'finish'];
const PROGRESS = { welcome: 14, heaviest: 28, plan: 43, account: 57, household: 63, invite: 75, whatsapp: 88, calendar: 100, finish: 100 };

// Where to drop the user in based on auth state, so a refresh / email-verify
// return resumes correctly instead of restarting. -1 => already onboarded.
function entryIndex({ token, household, user }) {
  if (!token) return 0;                  // welcome (pre-auth)
  if (!household) return 4;              // account done, needs a household
  if (!user?.onboarded_at) return 5;     // household done, finish the setup
  return -1;                             // fully onboarded
}

const firstNameOf = (user) => (user?.name || '').trim().split(/\s+/)[0] || 'there';

export default function OnboardingFlow() {
  const auth = useAuth();
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();

  const [idx, setIdx] = useState(() => entryIndex(auth));
  const [form, setForm] = useState({
    pains: ['head', 'nag'],   // sensible defaults so the plan screen is never empty
    hhMode: 'new', hhName: '', joinCode: '',
    invited: [],
    calProvider: null, calUrl: '',
  });
  const [error, setError] = useState('');
  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  // A fully-onboarded session should never see the flow (e.g. typed /start).
  if (auth.token && auth.household && auth.user?.onboarded_at) {
    return <Navigate to="/dashboard" replace />;
  }

  const key = STEPS[Math.max(0, idx)];
  const isFirst = idx <= 0;

  const next = () => setIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setIdx((i) => Math.max(i - 1, 0));

  // Escape hatch - a half-finished signup would otherwise be trapped here by
  // RequireAuth's redirect. Logging out clears the token so the landing renders.
  const signOut = () => { auth.logout(); window.location.href = '/'; };

  const ctx = {
    auth, navigate, reduced,
    form, update,
    next, back, setError,
    firstName: firstNameOf(auth.user),
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden flex flex-col"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)' }}
    >
      {/* Ambient blobs (decorative) - same treatment as Login/Signup/Onboarding. */}
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 760, height: 760, borderRadius: '50%', left: -180, bottom: -300, background: 'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)', filter: 'blur(20px)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 600, height: 600, borderRadius: '50%', right: -160, top: -200, background: 'radial-gradient(circle, rgba(107,63,160,0.18) 0%, rgba(107,63,160,0) 70%)', filter: 'blur(20px)' }} />

      <main className="relative z-10 flex-1 flex items-start justify-center px-4 pt-10 pb-8 md:pt-14 md:pb-10">
        <div
          key={reduced ? 'static' : key /* re-mount per step so the enter animation fires */}
          className={reduced ? '' : 'ob-card-in'}
          style={{
            position: 'relative', width: '100%', maxWidth: 560,
            background: 'rgba(255,253,250,0.9)',
            backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.9)', borderRadius: 28,
            boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
            padding: '28px 32px 30px', textAlign: 'center',
          }}
        >
          {/* Progress header: back chevron (hidden on the first step) + fill bar. */}
          <div className="flex items-center gap-3 mb-6">
            <button
              type="button"
              onClick={back}
              aria-label="Back"
              className="shrink-0 flex items-center justify-center rounded-xl transition-colors"
              style={{ width: 38, height: 38, border: 0, cursor: isFirst ? 'default' : 'pointer', background: '#F3EEE5', color: '#6B6774', visibility: isFirst ? 'hidden' : 'visible' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: 6, background: '#F3EEE5' }}>
              <div className="h-full rounded-full" style={{ width: `${PROGRESS[key]}%`, background: 'var(--color-plum)', transition: reduced ? 'none' : 'width .45s cubic-bezier(0.22,1,0.36,1)' }} />
            </div>
          </div>

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {renderStep(key, ctx)}
        </div>
      </main>

      <footer className="relative z-10 safe-bottom">
        <div className="max-w-[560px] mx-auto px-5 py-4 flex items-center justify-end text-xs">
          {auth.token && (
            <button type="button" onClick={signOut} className="text-cocoa hover:text-bark transition-colors">Sign out</button>
          )}
        </div>
      </footer>
    </div>
  );
}

// Step renderer. Phase 0 ships navigable placeholders; later phases replace each
// branch with the real step component.
function renderStep(key, ctx) {
  return <StepPlaceholder stepKey={key} ctx={ctx} />;
}

function StepPlaceholder({ stepKey, ctx }) {
  const isLast = stepKey === 'finish';
  return (
    <div className="text-left">
      <h1 style={{ fontFamily: SERIF, fontSize: 40, fontWeight: 400, lineHeight: 1.05, color: 'var(--color-charcoal)', margin: '8px 0 8px' }}>
        {stepKey}
      </h1>
      <p className="text-cocoa" style={{ fontSize: 15 }}>Step placeholder. Real content lands in the next phase.</p>
      <button
        type="button"
        onClick={() => (isLast ? ctx.navigate('/dashboard') : ctx.next())}
        className="w-full text-white font-bold transition-colors"
        style={{ marginTop: 24, padding: 16, border: 0, borderRadius: 14, background: 'var(--color-plum)', fontSize: 16, cursor: 'pointer' }}
      >
        {isLast ? 'Go to dashboard' : 'Continue'}
      </button>
    </div>
  );
}
