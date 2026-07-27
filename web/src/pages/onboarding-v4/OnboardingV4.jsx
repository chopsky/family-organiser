/**
 * Onboarding v4 — flow shell.
 *
 * Value-first 12-screen flow from design_handoff_onboarding. Sign-up stays at
 * step 11 by design: everything before it is held client-side (see
 * lib/onboardingDraft) and replayed once the account exists, because a calendar
 * feed needs user_id + household_id and a WhatsApp link is a column on users.
 *
 * Phase 3 batch 1 (here): splash and the pickers are the designed screens.
 * The chat beats (03, 09), calendars (08), reminders (10), sign-up (11) and
 * welcome (12) are still stand-ins and land in the next batches.
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
import { SignUpScreen, LoginScreen, DoneScreen } from './authScreens';

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
        // Real providers + session handling arrive in Phase 5.
        onPick={() => navigate('/signup')}
      />
    );
  }

  if (phase === 'signup') {
    return (
      <SignUpScreen
        d={d}
        onBack={back}
        // Phase 5 replaces this with real auth, then replays the queued
        // calendar + WhatsApp connections against the new household.
        onPick={() => f.finish()}
      />
    );
  }

  if (phase === 'done') {
    return <DoneScreen d={d} reduced={reduced} onEnter={() => navigate('/dashboard')} />;
  }

  const skipLabel = skipLabelAt(f.i);
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
        onBack={back}
        footer={step === 'ask' ? (
          // Screen 09 owns its footer entirely - a green WhatsApp button, not
          // the standard CTA, and no skip once the answer is in.
          <WhatsAppFooter on={d.wa} onConnect={connectWhatsApp} onSkip={skip} />
        ) : (
          <>
            {!autoAdvances(f.i) && (
              <Cta disabled={!canAdvance || (step === 'plan' && !planDone)} onClick={advance}>
                {step === 'pains'
                  ? ((d.pains || []).length === 0 ? 'Pick at least one' : `That’s my list (${d.pains.length})`)
                  : step === 'plan' ? (planDone ? 'Sounds good' : 'One sec…')
                    : step === 'house' ? 'Put the sign up' : 'Continue'}
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

        {(step === 'cals' || step === 'reminders') && (
          <>
            <p style={{ font: '700 11.5px Inter, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: T.purple }}>
              {step}
            </p>
            <h1 style={{ fontFamily: T.title, fontWeight: 400, fontSize: 34, lineHeight: 1.08, letterSpacing: '-.015em', marginTop: 8 }}>
              {step} screen
            </h1>
            <p style={{ fontSize: 15, color: T.ink2, marginTop: 8 }}>Stand-in — arrives in the next batch.</p>
          </>
        )}
      </Step>
    </>
  );
}

