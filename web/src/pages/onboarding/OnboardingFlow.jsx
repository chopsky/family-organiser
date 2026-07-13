/**
 * OnboardingFlow - the single continuous new-user flow, rebuilt from the
 * design_handoff_onboarding prototype. Linear steps spanning the auth
 * boundary in ONE mounted component:
 *
 *   1 account                            (creates the account; pre-auth entry)
 *   2 household 3 invite 4 whatsapp 5 calendar 6 finish     (authenticated)
 *
 * The account card is the landing screen, surrounded by the four corner
 * notifications. (The earlier welcome/heaviest/plan pitch steps were removed.)
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
import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isIos, APP_STORE_CONFIGURED } from '../../lib/app-store';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import AuthHeader from '../../components/AuthHeader';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { resolveSignupPromo, clearSignupPromo } from '../../lib/signupPromo';
import WelcomeNotifications from './steps/WelcomeNotifications';
import AccountStep from './steps/AccountStep';
import HouseholdStep from './steps/HouseholdStep';
import InviteStep from './steps/InviteStep';
import WhatsAppStep from './steps/WhatsAppStep';
import CalendarStep from './steps/CalendarStep';
import GetAppStep from './steps/GetAppStep';
import FinishStep from './steps/FinishStep';

// The "Get the app" nudge belongs ONLY to someone finishing onboarding in a
// mobile BROWSER on an iPhone: not inside the native app (already there), not on
// Android/desktop (no app), and not before a live App Store listing exists.
// When false, next()/back() skip straight over the get-app step.
//
// TEMPORARILY OFF: the live App Store build is stale (the developer account is
// migrating individual -> organisation, which blocks updates), so we must NOT
// push fresh web signups to download the outdated app. Flip APP_STORE_BUILD_CURRENT
// back to true once the new version is approved and live, and the step returns
// for iPhone-web users as before.
const APP_STORE_BUILD_CURRENT = false;
const SHOW_GET_APP = APP_STORE_BUILD_CURRENT && !Capacitor.isNativePlatform() && isIos() && APP_STORE_CONFIGURED;

// Step keys in order + the progress-bar fill per step. The account card is the
// pre-auth entry screen; 'get-app' sits just before 'finish' and is skipped for
// non-iPhone-web users.
const STEPS = ['account', 'household', 'invite', 'whatsapp', 'calendar', 'get-app', 'finish'];
const PROGRESS = { account: 16, household: 34, invite: 52, whatsapp: 72, calendar: 100, 'get-app': 100, finish: 100 };

// Where to drop the user in based on auth state, so a refresh / email-verify
// return resumes correctly instead of restarting. -1 => already onboarded.
function entryIndex({ token, household, user }) {
  if (!token) return 0;                                    // account (pre-auth entry)
  if (!household) return STEPS.indexOf('household');       // account done, needs a household
  if (!user?.onboarded_at) return STEPS.indexOf('invite'); // household done, finish the setup
  return -1;                                               // fully onboarded
}

const firstNameOf = (user) => (user?.name || '').trim().split(/\s+/)[0] || 'there';

// Persist the furthest post-auth step so closing/reopening the browser mid-flow
// resumes where the user actually was (not back at the invite step). Keyed by
// household id so a stale value from a different household is ignored.
const PROGRESS_KEY = 'housemait_onboarding_step';
function loadStoredStep(householdId) {
  if (!householdId) return null;
  try {
    const { hh, idx } = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
    return hh === householdId && typeof idx === 'number' ? idx : null;
  } catch { return null; }
}
function clearStoredStep() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* private mode */ }
}

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
    // Resume the furthest post-auth step for THIS household, so reopening the
    // browser mid-flow doesn't dump the user back at the invite step.
    if (e >= STEPS.indexOf('household') && auth.household?.id) {
      const stored = loadStoredStep(auth.household.id);
      if (stored != null && stored > e) return Math.min(stored, STEPS.length - 1);
      // No saved progress on THIS device (a different device, or cleared
      // storage) but the household already exists: everything left is optional
      // (invite/WhatsApp/calendar, all re-promptable later). Land on the finish
      // screen to wrap up in one tap rather than re-walking the invite step.
      if (stored == null && e === STEPS.indexOf('invite')) return STEPS.indexOf('finish');
    }
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
  const [finishing, setFinishing] = useState(false);
  const update = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Remember the current step (once a household exists) so a reopen resumes here.
  useEffect(() => {
    if (!auth.household?.id || idx < STEPS.indexOf('household')) return;
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ hh: auth.household.id, idx })); }
    catch { /* private mode */ }
  }, [idx, auth.household?.id]);

  // A fully-onboarded session should never see the flow (e.g. typed /signup).
  if (auth.token && auth.household && auth.user?.onboarded_at) {
    return <Navigate to="/dashboard" replace />;
  }

  const key = STEPS[Math.max(0, idx)];
  // Account + household creation are committed, one-time actions. Once done,
  // "Back" must not return to those steps: re-submitting create-household with
  // the same name fails / dupes, stranding the user (the only escapes being a
  // differently-named household or a manual refresh — the reported dead-end).
  // So clamp the back floor to the first step that's still safe to revisit:
  // once a household exists → the invite step; once signed up → the household
  // step; otherwise the account step.
  const backFloor = auth.household
    ? STEPS.indexOf('invite')
    : (auth.token ? STEPS.indexOf('household') : 0);
  const isFirst = idx <= backFloor;

  // Advance/retreat one step, hopping over 'get-app' when it isn't shown for
  // this visitor (so non-iPhone-web users go calendar <-> finish directly).
  const next = () => setIdx((i) => {
    let n = Math.min(i + 1, STEPS.length - 1);
    if (STEPS[n] === 'get-app' && !SHOW_GET_APP) n = Math.min(n + 1, STEPS.length - 1);
    return n;
  });
  const back = () => setIdx((i) => {
    let n = Math.max(i - 1, backFloor);
    if (STEPS[n] === 'get-app' && !SHOW_GET_APP) n = Math.max(n - 1, backFloor);
    return n;
  });

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
      clearStoredStep();
      navigate('/dashboard');
    }
  };

  const ctx = {
    auth, navigate, reduced,
    form, update,
    next, back, setError,
    goAfterAuth, finish, finishing,
    inviteToken, promoCode: form.promoCode,
    firstName: firstNameOf(auth.user),
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden flex flex-col"
      style={{
        background: 'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
        // Keep the card clear of the iOS status bar / notch. 0 on the web.
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Ambient blobs (decorative) - same treatment as Login/Signup/SetupHousehold. */}
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 760, height: 760, borderRadius: '50%', left: -180, bottom: -300, background: 'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)', filter: 'blur(20px)' }} />
      <div aria-hidden="true" className="pointer-events-none absolute" style={{ width: 600, height: 600, borderRadius: '50%', right: -160, top: -200, background: 'radial-gradient(circle, rgba(107,63,160,0.18) 0%, rgba(107,63,160,0) 70%)', filter: 'blur(20px)' }} />

      {/* Entry-step corner notifications (decorative, stage-level, behind the
          card). Shown around the first (account) card. Hidden under 880px. */}
      {key === 'account' && <WelcomeNotifications reduced={reduced} />}

      {/* Auth header (logo + "Log in") only on the entry/account card - the
          rest of the flow is post-signup, where a "Log in" link makes no
          sense. The account card's top padding below is bumped to clear it.
          Hidden in the native apps: the marketing-style header is redundant
          chrome there (the card already carries its own "Log in" link). */}
      {key === 'account' && !Capacitor.isNativePlatform() && <AuthHeader cta={{ label: 'Log in', to: '/login' }} />}

      {/* All steps vertically centred. A short card sits in the middle; a card
          taller than the screen grows the page and scrolls from the top (so its
          top never clips). The stage's env(safe-area-inset-top) already clears
          the iOS status bar, so the small pt just keeps a tight gap below it for
          the tall, top-aligned cards. */}
      <main className={`relative z-10 flex-1 flex flex-col items-center justify-center px-4 pb-8 md:pb-10 ${key === 'account' && !Capacitor.isNativePlatform() ? 'pt-20 md:pt-20' : 'pt-3 md:pt-14'}`}>
        <div
          key={reduced ? 'static' : key /* re-mount per step so the enter animation fires */}
          className={`ob-card ${reduced ? '' : 'ob-card-in'}`}
          style={{
            position: 'relative', width: '100%', maxWidth: 480,
            background: 'rgba(255,253,250,0.9)',
            backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)',
            border: '1px solid rgba(255,255,255,0.9)', borderRadius: 28,
            boxShadow: '0 30px 80px -20px rgba(26,22,32,0.25), inset 0 2px 0 rgba(255,255,255,0.6)',
            textAlign: 'center',
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
    </div>
  );
}

// Step renderer. Pre-auth steps are live; the authenticated steps land in later
// phases and still show navigable placeholders for now.
function renderStep(key, ctx) {
  switch (key) {
    case 'account':
      return <AccountStep form={ctx.form} update={ctx.update} setError={ctx.setError} goAfterAuth={ctx.goAfterAuth} inviteToken={ctx.inviteToken} promoCode={ctx.promoCode} navigate={ctx.navigate} />;
    case 'household':
      return <HouseholdStep auth={ctx.auth} form={ctx.form} update={ctx.update} next={ctx.next} setError={ctx.setError} />;
    case 'invite':
      return <InviteStep auth={ctx.auth} form={ctx.form} update={ctx.update} next={ctx.next} setError={ctx.setError} />;
    case 'whatsapp':
      return <WhatsAppStep next={ctx.next} setError={ctx.setError} />;
    case 'calendar':
      return <CalendarStep form={ctx.form} update={ctx.update} next={ctx.next} setError={ctx.setError} />;
    case 'get-app':
      return <GetAppStep next={ctx.next} />;
    case 'finish':
      return <FinishStep firstName={ctx.firstName} householdName={ctx.form.hhName || ctx.auth.household?.name} userId={ctx.auth.user?.id} invited={ctx.form.invited} finishing={ctx.finishing} onFinish={ctx.finish} />;
    default:
      return null;
  }
}
