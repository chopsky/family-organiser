/**
 * OnboardingFlow - the single continuous new-user flow, rebuilt from the
 * design_handoff_onboarding prototype. Nine linear steps spanning the auth
 * boundary in ONE mounted component:
 *
 *   1 welcome   2 heaviest   3 plan      (pre-auth, local state)
 *   4 account                            (creates the account)
 *   5 household 6 invite  7 whatsapp  8 calendar  9 finish  (authenticated)
 *
 * Google SSO is a popup (no full-page redirect), so the flow stays mounted
 * through account creation and continues in place. The email path pauses at
 * "check your inbox"; after verifying, the auth gate funnels the user back here
 * and entryIndex() resumes them at the right step.
 *
 * Mounted at /signup (it replaced the old single-screen Signup form). Visual
 * language reuses the existing concierge stage (gradient + ambient blobs + glass
 * card) in our plum tokens. British English, no em dashes,
 * prefers-reduced-motion honoured.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { resolveSignupPromo, clearSignupPromo } from '../../lib/signupPromo';
import WelcomeStep from './steps/WelcomeStep';
import WelcomeNotifications from './steps/WelcomeNotifications';
import HeaviestStep from './steps/HeaviestStep';
import PlanStep from './steps/PlanStep';
import AccountStep from './steps/AccountStep';
import HouseholdStep from './steps/HouseholdStep';
import InviteStep from './steps/InviteStep';
import WhatsAppStep from './steps/WhatsAppStep';
import CalendarStep from './steps/CalendarStep';
import FinishStep from './steps/FinishStep';

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
  const [searchParams] = useSearchParams();

  // Carried from the URL: an invite token (joining a specific household) and a
  // tagged campaign promo. resolveSignupPromo persists the promo so it survives
  // the steps-1-3 walk + the email-verify round trip.
  const inviteToken = searchParams.get('invite') || undefined;

  const [idx, setIdx] = useState(() => {
    const e = entryIndex(auth);
    // Invited users arrive via /signup?invite= and join a specific household, so
    // skip the marketing pitch (welcome/heaviest/plan) and start at account.
    if (e === 0 && inviteToken) return STEPS.indexOf('account');
    return e;
  });
  const [form, setForm] = useState(() => ({
    pains: ['head', 'nag'],   // sensible defaults so the plan screen is never empty
    accName: '',
    promoCode: resolveSignupPromo(searchParams),
    hhMode: 'new', hhName: '', joinCode: '',
    invited: [],
    calProvider: null, calUrl: '',
  }));
  const [error, setError] = useState('');
  const [leavingWelcome, setLeavingWelcome] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  // A fully-onboarded session should never see the flow (e.g. typed /signup).
  if (auth.token && auth.household && auth.user?.onboarded_at) {
    return <Navigate to="/dashboard" replace />;
  }

  const key = STEPS[Math.max(0, idx)];
  const isFirst = idx <= 0;

  const next = () => setIdx((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setIdx((i) => Math.max(i - 1, 0));

  // Welcome continue: let the corner notifications drift out to their corners,
  // then advance. Under reduced motion there is nothing to wait for.
  const leaveWelcome = () => {
    if (reduced) { next(); return; }
    setLeavingWelcome(true);
    setTimeout(() => { setLeavingWelcome(false); next(); }, 480);
  };

  // Account created/authenticated (Google popup or an invite auto-join). Store
  // the session, consume the promo, then resume at the right step: an existing
  // household jumps to invite (the top-level guard sends fully-onboarded users
  // to the dashboard); a fresh account goes to the household step.
  const goAfterAuth = (data) => {
    clearSignupPromo();
    auth.login(data);
    setIdx(STEPS.indexOf(data?.household ? 'invite' : 'household'));
  };

  // Finish: flip users.onboarded_at server-side, patch the cached user so the
  // auth gate stops funnelling back here, then land on the dashboard. A failed
  // mark-onboarded must not trap the user, so we navigate regardless.
  const finish = async () => {
    setFinishing(true);
    try {
      const { data } = await api.post('/auth/mark-onboarded');
      if (data?.user) auth.updateUser(data.user);
    } catch (err) {
      console.error('[onboarding] mark-onboarded failed:', err?.response?.data?.error || err.message);
    } finally {
      navigate('/dashboard');
    }
  };

  // Escape hatch - a half-finished signup would otherwise be trapped here by
  // RequireAuth's redirect. Logging out clears the token so the landing renders.
  const signOut = () => { auth.logout(); window.location.href = '/'; };

  const ctx = {
    auth, navigate, reduced,
    form, update,
    next, back, setError,
    leaveWelcome, goAfterAuth, finish, finishing,
    inviteToken, promoCode: form.promoCode,
    firstName: firstNameOf(auth.user),
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden flex flex-col"
      style={{ background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)' }}
    >
      {/* Ambient blobs (decorative) - same treatment as Login/Signup/SetupHousehold. */}
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 760, height: 760, borderRadius: '50%', left: -180, bottom: -300, background: 'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)', filter: 'blur(20px)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 600, height: 600, borderRadius: '50%', right: -160, top: -200, background: 'radial-gradient(circle, rgba(107,63,160,0.18) 0%, rgba(107,63,160,0) 70%)', filter: 'blur(20px)' }} />

      {/* Welcome-step corner notifications (decorative, stage-level, behind the
          card). Hidden under 880px via CSS. */}
      {key === 'welcome' && <WelcomeNotifications leaving={leavingWelcome} reduced={reduced} />}

      {/* Welcome is short, so centre it vertically; the later (often taller)
          steps stay top-aligned so they never clip on short viewports. */}
      <main className={`relative z-10 flex-1 flex justify-center px-4 ${key === 'welcome' ? 'items-center py-8' : 'items-start pt-10 pb-8 md:pt-14 md:pb-10'}`}>
        <div
          key={reduced ? 'static' : key /* re-mount per step so the enter animation fires */}
          className={reduced ? '' : 'ob-card-in'}
          style={{
            position: 'relative', width: '100%', maxWidth: 480,
            background: 'rgba(255,253,250,0.9)',
            backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.9)', borderRadius: 28,
            boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
            padding: '30px 40px 30px', textAlign: 'center',
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

      {/* Sign-out escape hatch, only once a session exists. Omitting the footer
          pre-auth lets <main> fill the full height so the welcome card centres. */}
      {auth.token && (
        <footer className="relative z-10 safe-bottom">
          <div className="max-w-[480px] mx-auto px-5 py-4 flex items-center justify-end text-xs">
            <button type="button" onClick={signOut} className="text-cocoa hover:text-bark transition-colors">Sign out</button>
          </div>
        </footer>
      )}
    </div>
  );
}

// Step renderer. Pre-auth steps are live; the authenticated steps land in later
// phases and still show navigable placeholders for now.
function renderStep(key, ctx) {
  switch (key) {
    case 'welcome':
      return <WelcomeStep onContinue={ctx.leaveWelcome} navigate={ctx.navigate} />;
    case 'heaviest':
      return <HeaviestStep form={ctx.form} update={ctx.update} next={ctx.next} />;
    case 'plan':
      return <PlanStep form={ctx.form} next={ctx.next} />;
    case 'account':
      return <AccountStep form={ctx.form} update={ctx.update} setError={ctx.setError} goAfterAuth={ctx.goAfterAuth} inviteToken={ctx.inviteToken} promoCode={ctx.promoCode} />;
    case 'household':
      return <HouseholdStep auth={ctx.auth} form={ctx.form} update={ctx.update} next={ctx.next} setError={ctx.setError} />;
    case 'invite':
      return <InviteStep auth={ctx.auth} form={ctx.form} update={ctx.update} next={ctx.next} setError={ctx.setError} />;
    case 'whatsapp':
      return <WhatsAppStep next={ctx.next} setError={ctx.setError} />;
    case 'calendar':
      return <CalendarStep form={ctx.form} update={ctx.update} next={ctx.next} setError={ctx.setError} />;
    case 'finish':
      return <FinishStep firstName={ctx.firstName} householdName={ctx.form.hhName || ctx.auth.household?.name} invited={ctx.form.invited} finishing={ctx.finishing} onFinish={ctx.finish} />;
    default:
      return null;
  }
}
