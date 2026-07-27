/**
 * Onboarding v4 — flow shell.
 *
 * Value-first 12-screen flow from design_handoff_onboarding. Sign-up stays at
 * step 11 by design: everything before it is held client-side (see
 * lib/onboardingDraft) and replayed once the account exists, because a calendar
 * feed needs user_id + household_id and a WhatsApp link is a column on users.
 *
 * All twelve screens are the designed ones and auth is live: providers come
 * from the shared useSocialAuth (the same hook behind the existing signup
 * page), and useV4Auth turns the resulting session into a finished household —
 * naming it, replaying the queued calendars, offering WhatsApp pairing.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { T } from './tokens';
import { skipLabelAt, autoAdvances } from './machine';
import useOnboardingFlow from './useOnboardingFlow';
import { Step, Cta, Ghost } from './ui';
import {
  Splash, PainPicker, ShapePicker, NameStep, RoleStep, HouseStep, HouseSignOverlay,
} from './screens';
import { PlanBeat, AskBeat, WhatsAppFooter } from './chatBeats';
import { CalendarList, CalendarConnect } from './calendarScreens';
import { RemindersBody, RemindersFooter } from './remindersScreen';
import { askForNudges } from '../../lib/notificationPermission';
import { SignUpScreen, LoginScreen, DoneScreen } from './authScreens';
import { setCalUrl } from '../../lib/onboardingDraft';
import useSocialAuth from '../../hooks/useSocialAuth';
import useV4Auth from './useV4Auth';

export default function OnboardingV4() {
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const f = useOnboardingFlow();
  const { phase, step, pct, d, update, next, back, skip, goPhase, pickAndAdvance, canAdvance } = f;

  // The house-sign reward sits between submitting the name and advancing, so
  // it's local to the shell rather than a step in its own right.
  const [sign, setSign] = useState(false);
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
  const [authError, setAuthError] = useState('');
  const socialAuth = useSocialAuth({
    onSuccess: async (data) => { if (await v4.completeSignup(data)) f.finish(); },
    onError: setAuthError,
  });

  // Notification permission is a one-shot OS prompt, so the screen owns a busy
  // flag and an explanation line rather than silently doing nothing.
  const [remBusy, setRemBusy] = useState(false);
  const [remNote, setRemNote] = useState('');

  const askNudges = async () => {
    setRemBusy(true);
    const { granted, note } = await askForNudges();
    setRemBusy(false);
    update({ rem: granted });
    if (!granted && note) {
      // Show why, briefly, then move on - this step is never a gate.
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

  // Taking the WhatsApp "yes" records intent only; the real pairing runs after
  // sign-up (a WhatsApp link is a column on users, and there is no user yet).
  const connectWhatsApp = () => {
    update({ wa: true });
    setTimeout(next, 900);
  };

  if (phase === 'splash') {
    return <Splash reduced={reduced} onStart={() => goPhase('flow', 0)} onLogin={() => goPhase('login')} />;
  }

  if (phase === 'login') {
    return (
      <LoginScreen
        onBack={back}
        onCreate={() => goPhase('flow', 0)}
        auth={socialAuth}
        v4={v4}
        // An existing account has a household already: straight to the app,
        // never through the welcome screen, which is for new households.
        onLoggedIn={() => navigate('/dashboard')}
      />
    );
  }

  if (phase === 'signup') {
    return (
      <SignUpScreen
        d={d}
        onBack={back}
        auth={socialAuth}
        v4={{ ...v4, error: v4.error || authError, setError: (e) => { v4.setError(e); setAuthError(e); } }}
      />
    );
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
      <Step
        pct={pct}
        reduced={reduced}
        // Inside a provider's connect flow, back means "leave this provider",
        // not "leave the calendar step".
        onBack={connecting ? () => setConnecting(null) : back}
        footer={connecting ? null : step === 'ask' ? (
          // Screen 09 owns its footer entirely - a green WhatsApp button, not
          // the standard CTA, and no skip once the answer is in.
          <WhatsAppFooter on={d.wa} onConnect={connectWhatsApp} onSkip={skip} onContinue={next} />
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
        {step === 'house' && <HouseStep d={d} update={update} onEnter={() => canAdvance && advance()} />}

        {step === 'plan' && <PlanBeat d={d} reduced={reduced} onDone={() => setPlanDone(true)} />}
        {step === 'ask' && <AskBeat d={d} reduced={reduced} />}

        {step === 'cals' && (connecting ? (
          <CalendarConnect
            providerId={connecting}
            onDone={calendarConnected}
            onCancel={() => setConnecting(null)}
          />
        ) : (
          <CalendarList d={d} onConnect={setConnecting} />
        ))}

        {step === 'reminders' && <RemindersBody d={d} reduced={reduced} note={remNote} />}
      </Step>
    </>
  );
}

