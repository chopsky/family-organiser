/**
 * Onboarding v4 — flow shell.
 *
 * Value-first flow from design_handoff_onboarding. Sign-up stays last-but-one
 * by design: everything before it is held client-side (see lib/onboardingDraft)
 * and replayed once the account exists, because a calendar feed needs
 * user_id + household_id. WhatsApp pairing is the exception: it happens LIVE
 * in the post-auth 'whatsapp' phase (whatsappLinkScreen.jsx) between sign-up
 * and the celebration - the one moment a number can actually be bound.
 *
 * Providers come from the shared useSocialAuth (the same hook behind the
 * existing signup page), and useV4Auth turns the resulting session into a
 * finished household — naming it, replaying the queued calendars.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { T } from './tokens';
import { skipLabelAt, autoAdvances, forwardFrom } from './machine';
import InviteCodeOverlay from './inviteCodeScreen';
import useOnboardingFlow from './useOnboardingFlow';
import { Step, Cta, Ghost, ResumeNotice } from './ui';
import {
  Splash, PainPicker, ShapePicker, NameStep, RoleStep, KidsStep, HouseStep, HouseSignOverlay, SchoolStep } from './screens';
import { PlanBeat } from './chatBeats';
import { CalendarList, CalendarConnect } from './calendarScreens';
import { RemindersBody, RemindersFooter } from './remindersScreen';
import InboxStep, { InboxFooter } from './inboxScreen';
import { askForNudges } from '../../lib/notificationPermission';
import { SignUpScreen, LoginScreen, DoneScreen } from './authScreens';
import PaywallScreen from './paywallScreen';
import WhatsAppLinkScreen from './whatsappLinkScreen';
import { setCalUrl, clearDraft } from '../../lib/onboardingDraft';
import { trackOnboardingStep } from '../../lib/onboardingTelemetry';
import useSocialAuth from '../../hooks/useSocialAuth';
import useV4Auth from './useV4Auth';

// initialPhase lets a route open the flow somewhere other than the splash.
// /login uses it so signing out lands on v4's own sign-in screen instead of
// the web login page, which looks nothing like the rest of the app.
export default function OnboardingV4({ initialPhase }) {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const f = useOnboardingFlow(initialPhase);
  const { phase, step, pct, d, update, next, back, skip, goPhase, pickAndAdvance, canAdvance } = f;

  // The house-sign reward sits between submitting the name and advancing, so
  // it's local to the shell rather than a step in its own right.
  const [sign, setSign] = useState(false);
  // The "join an existing home" code overlay - reachable from the first
  // step and the house step, the two places a second adult realises the
  // flow is about to found a household they already have.
  const [joinEntry, setJoinEntry] = useState(false);
  const openJoin = () => { trackOnboardingStep('invitecode', 'enter'); setJoinEntry(true); };
  // The plan screen's CTA stays disabled until its scripted reply finishes -
  // letting someone skip past the payback would waste the screen's whole job.
  const [planDone, setPlanDone] = useState(false);
  // Which provider's connect flow is open, if any. A sub-view of step 08
  // rather than a step of its own, so the progress bar doesn't jump.
  const [connecting, setConnecting] = useState(null);

  // Auth. useV4Auth turns a session into a finished household (naming it,
  // replaying the queued calendars, marking onboarded); useSocialAuth drives
  // the providers and hands their payload straight to it. The same hook backs
  // the existing signup page, so the two can't drift.
  const v4 = useV4Auth(d);
  const appAuth = useAuth();
  const [authError, setAuthError] = useState('');
  // The provider buttons appear on the sign-up screen AND the login screen,
  // and only the sign-up one may run the draft-replay completion: a login
  // must land in the account as it exists, never dressed in (or mutated by)
  // an abandoned draft from an earlier run on this device.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const socialAuth = useSocialAuth({
    onSuccess: async (data) => {
      if (phaseRef.current === 'login') {
        appAuth.login(data);
        clearDraft();
        navigate('/dashboard');
        return;
      }
      if (await v4.completeSignup(data)) f.finish();
    },
    onError: setAuthError,
  });

  // Notification permission is a one-shot OS prompt, so the screen owns a busy
  // flag and an explanation line rather than silently doing nothing.
  const [remBusy, setRemBusy] = useState(false);
  const [remNote, setRemNote] = useState('');

  // Step 10's footer lives in the Step frame but its state (typed slug,
  // claim progress) lives in the step body - so the body publishes both
  // upward and hands back the claim action for the footer to fire.
  const [{ value: inboxValue, claim: inboxClaim }, setInboxState] = useState({ value: '', claim: 'idle' });
  const inboxClaimRef = useRef(null);

  // Arriving from the verification LINK. Verify.jsx redeems the token, logs
  // the user in and sends them to /signup - so v4 remounts with a live session
  // and the restored draft, but nothing replayed and no household. Left alone
  // it would show the splash screen to someone who has just finished signing
  // up. Pick the thread back up instead and land them on the welcome screen.
  //
  // Gated on a household NAME in the draft: that is the marker of a real v4
  // run reaching step 07. Without it there is nothing to create and nothing to
  // replay, so the flow should simply carry on rather than declare itself done.
  const needsResume = Boolean(appAuth.token) && !appAuth.user?.onboarded_at && Boolean((d.house || '').trim());
  const resumedRef = useRef(false);
  const [resuming, setResuming] = useState(needsResume);
  useEffect(() => {
    if (!needsResume || resumedRef.current) return;
    resumedRef.current = true;
    (async () => {
      const ok = await v4.resumeVerifiedSession();
      setResuming(false);
      if (ok) f.finish();
    })();
    // f and v4 are recreated every render; the ref is what makes this run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsResume]);

  const askNudges = async () => {
    setRemBusy(true);
    const { granted, note } = await askForNudges();
    setRemBusy(false);
    update({ rem: granted });
    if (note) {
      // Show the outcome briefly, then move on - this step is never a gate.
      // Notes exist for BOTH answers now: a decline explains where the switch
      // lives, and an already-granted device says the step worked - without
      // it, iOS's one-shot prompt staying hidden reads as a broken button.
      setRemNote(note);
      setTimeout(next, 1400);
      return;
    }
    next();
  };

  // A verified calendar. The URL goes to the in-memory store only (it's a
  // bearer credential); the draft records the fact of the connection, which is
  // what the recap and the post-signup replay need.
  const calendarConnected = (providerId, url, result) => {
    setCalUrl(providerId, url);
    update((prev) => ({
      cals: { ...prev.cals, [providerId]: { eventCount: result.eventCount, name: result.name } },
    }));
    setConnecting(null);
  };

  // Held while the link-arrival resume runs, so the splash never flashes at
  // someone who has already finished signing up.
  if (resuming) {
    return (
      <div style={{
        minHeight: '100dvh', display: 'grid', placeItems: 'center',
        background: T.cream, color: T.ink3, fontSize: 15, padding: 24, textAlign: 'center',
      }}>
        Email verified — setting up your home…
      </div>
    );
  }

  if (phase === 'splash') {
    return <Splash reduced={reduced} onStart={() => goPhase('flow', 0)} onLogin={() => goPhase('login')} />;
  }

  if (phase === 'login') {
    return (
      <LoginScreen
        onBack={back}
        // Where "Create an account" goes depends on how they got here. Arriving
        // from the splash, they have already seen the pitch, so jumping them
        // back to it would be a loop - go straight into the questions. Arriving
        // at /login directly (signing out lands here) they have seen nothing,
        // and dropping them on "Step 1 of 6" skips the screen that explains
        // what they are signing up for.
        onCreate={() => goPhase(initialPhase === 'login' ? 'splash' : 'flow', 0)}
        auth={socialAuth}
        v4={v4}
        // An existing account has a household already: straight to the app,
        // never through the welcome screen, which is for new households. Any
        // abandoned draft from an earlier run on this device dies here too.
        onLoggedIn={() => { clearDraft(); navigate('/dashboard'); }}
      />
    );
  }

  if (phase === 'signup') {
    return (
      <SignUpScreen
        d={d}
        onBack={back}
        auth={socialAuth}
        v4={{
          ...v4,
          error: v4.error || authError,
          setError: (e) => { v4.setError(e); setAuthError(e); },
          // A verified code has done everything a provider does, so it lands
          // on the same welcome screen rather than a second dead end.
          onVerified: () => f.finish(),
        }}
      />
    );
  }

  if (phase === 'paywall') {
    return (
      <PaywallScreen
        householdId={appAuth.household?.id}
        onDone={() => goPhase('done')}
        // An exit exists here too, not just from the launch gate: nobody
        // should have to force-quit the app to get off this screen.
        onSignOut={appAuth.logout}
      />
    );
  }

  // Post-auth WhatsApp pairing - the account exists now, so the link can
  // actually happen. The screen advances itself (link / skip / unavailable).
  if (phase === 'whatsapp') {
    return <WhatsAppLinkScreen reduced={reduced} onDone={() => goPhase('done')} />;
  }

  if (phase === 'done') {
    return <DoneScreen d={d} reduced={reduced} outcome={v4.outcome} onEnter={() => navigate('/dashboard')} />;
  }

  const calCount = Object.keys(d.cals || {}).length;
  // Once a calendar is in, "I'll do this later" is the wrong offer - the CTA
  // is the only sensible way on.
  const skipLabel = step === 'cals' && calCount > 0 ? null : skipLabelAt(f.i);
  // Submitting the household name shows the sign, which then advances.
  const advance = () => { if (step === 'house') setSign(true); else next(); };

  return (
    <>
      {sign && (
        <HouseSignOverlay
          name={d.house}
          reduced={reduced}
          onDone={() => { setSign(false); next(); }}
        />
      )}
      {joinEntry && (
        <InviteCodeOverlay
          onCancel={() => setJoinEntry(false)}
          onJoined={(info) => {
            // The draft flips to joiner mode: navigation now hops the
            // founder-only steps, the paywall is skipped, and signup will
            // carry the invite token. Name/role prefill from the invite
            // (the founder typed them when inviting) but never overwrite
            // anything already answered. next() would read the PREVIOUS
            // draft from its closure, so the hop is computed here against
            // the new one.
            const nd = {
              ...d,
              joining: { token: info.token, householdName: info.householdName || null, inviterName: info.inviterName || null },
              you: d.you || info.invitee?.name || '',
              role: d.role || info.invitee?.family_role || '',
            };
            update(() => nd);
            setJoinEntry(false);
            const target = forwardFrom(f.i - 1, nd); // "-1 then forward" = first live step at or after here
            goPhase(target.phase, target.i);
          }}
        />
      )}
      <Step
        pct={pct}
        reduced={reduced}
        // Only while there is something restored to explain. Dismissed by
        // "Start fresh", which also wipes the draft.
        notice={f.resumed ? <ResumeNotice onStartFresh={f.startFresh} /> : null}
        // Inside a provider's connect flow, back means "leave this provider",
        // not "leave the calendar step".
        onBack={connecting ? () => setConnecting(null) : back}
        footer={connecting ? null : step === 'inbox' ? (
          // Step 10 owns its footer: the CTA becomes a green confirmation
          // box on success, and the skip disappears once claiming starts.
          <>
            <InboxFooter value={inboxValue} claim={inboxClaim} onClaim={() => inboxClaimRef.current && inboxClaimRef.current()} />
            {inboxClaim === 'idle' && <Ghost onClick={skip}>Skip for now</Ghost>}
          </>
        ) : step === 'reminders' ? (
          // Screen 10's CTA triggers a one-shot OS prompt, so it is its own
          // control rather than the standard advance button.
          <RemindersFooter busy={remBusy} onAsk={askNudges} onSkip={skip} />
        ) : (
          <>
            {!autoAdvances(f.i) && (
              <Cta disabled={!canAdvance || (step === 'plan' && !planDone)} onClick={advance}>
                {step === 'pains'
                  ? ((d.pains || []).length === 0 ? 'Pick at least one' : `That’s my list (${d.pains.length})`)
                  : step === 'plan' ? (planDone ? 'Sounds good' : 'One sec…')
                    : step === 'house' ? 'Put the sign up'
                      // The calendar step is never a gate, so its CTA reads as
                      // "done here" rather than implying something is missing.
                      : step === 'cals' ? (calCount > 0 ? `Done · ${calCount} connected` : 'Continue')
                        : step === 'kids' ? ((d.kids || []).length > 0 ? `That’s everyone (${d.kids.length})` : 'Continue')
                          : step === 'school' ? (d.school ? 'Add this school' : 'Continue')
                            : 'Continue'}
              </Cta>
            )}
            {skipLabel && <Ghost onClick={skip}>{skipLabel}</Ghost>}
          </>
        )}
      >
        {step === 'pains' && (
          <PainPicker
            d={d}
            toggle={(id) => update((prev) => ({
              pains: prev.pains.includes(id) ? prev.pains.filter((x) => x !== id) : [...prev.pains, id],
            }))}
          />
        )}
        {step === 'shape' && <ShapePicker d={d} pick={pickAndAdvance} />}
        {step === 'you' && <NameStep d={d} update={update} onEnter={() => canAdvance && next()} />}
        {step === 'role' && <RoleStep d={d} pick={pickAndAdvance} />}
        {step === 'kids' && <KidsStep d={d} update={update} />}
        {step === 'school' && <SchoolStep d={d} update={update} />}
        {step === 'house' && (
          <HouseStep
            d={d}
            update={update}
            onEnter={() => canAdvance && advance()}
            joinLink={!d.joining ? (
              <button
                type="button"
                onClick={openJoin}
                style={{
                  marginTop: 12, padding: '6px 0', border: 0, background: 'transparent',
                  cursor: 'pointer', font: '600 13.5px Inter, sans-serif', color: T.ink2,
                  textDecoration: 'underline', textUnderlineOffset: 3, textAlign: 'left',
                }}
              >
                Joining an existing home? Enter your invite code
              </button>
            ) : null}
          />
        )}

        {step === 'plan' && <PlanBeat d={d} reduced={reduced} onDone={() => setPlanDone(true)} />}

        {step === 'cals' && (connecting ? (
          <CalendarConnect
            providerId={connecting}
            onDone={calendarConnected}
            onCancel={() => setConnecting(null)}
          />
        ) : (
          <CalendarList d={d} onConnect={setConnecting} />
        ))}

        {step === 'inbox' && (
          <InboxStep
            d={d}
            update={update}
            onNext={next}
            onState={setInboxState}
            claimRef={inboxClaimRef}
          />
        )}

        {step === 'reminders' && <RemindersBody d={d} reduced={reduced} note={remNote} />}

        {step === 'pains' && !d.joining && (
          <button
            type="button"
            onClick={openJoin}
            style={{
              marginTop: 18, padding: '10px 0', border: 0, background: 'transparent',
              cursor: 'pointer', font: '600 13.5px Inter, sans-serif', color: T.ink2,
              textDecoration: 'underline', textUnderlineOffset: 3, textAlign: 'left',
            }}
          >
            Someone already set up your home? Enter your invite code
          </button>
        )}
      </Step>
    </>
  );
}

