import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, emptyDraft, isDraftEmpty, loadDraft, saveDraft } from '../../lib/onboardingDraft';
import { trackOnboardingStep } from '../../lib/onboardingTelemetry';
import {
  AUTO_ADVANCE_MS, backFrom, backFromSignup, canAdvance,
  forwardFrom, progressPct, stepAt,
} from './machine';

/**
 * The v4 flow's single source of truth: navigation (phase + step index) and the
 * draft.
 *
 * Back preserving input falls out of the shape rather than being special-cased:
 * navigation only ever moves `nav`, and answers live in `d`, which navigation
 * never touches. Going back and forward again finds everything as it was.
 *
 * phase and i are ONE state object on purpose. They always change together, and
 * splitting them means every transition has to coordinate two setters - which
 * is exactly where off-by-one and stale-closure bugs breed.
 *
 * Transition rules live in machine.js so they stay readable and testable; this
 * hook owns only React state, the auto-advance timer, and draft persistence.
 */
export default function useOnboardingFlow(initialPhase = 'splash') {
  const [nav, setNav] = useState({ phase: initialPhase, i: 0 });
  const [d, setD] = useState(loadDraft);

  // Whether THIS mount began from a stored draft rather than a blank one.
  // Captured once, at mount: `d` fills up as the user answers, so asking later
  // would report every in-progress flow as a resume. The flag exists so a
  // restore is never silent - four pre-ticked boxes on what looks like a fresh
  // Step 1, or a WhatsApp step already showing "WhatsApp it is", read as the
  // app inventing answers rather than remembering them.
  const [resumed, setResumed] = useState(() => !isDraftEmpty(loadDraft()));

  /**
   * Throw the restored answers away and start the flow over.
   *
   * Navigation resets too. Clearing only the answers would strand someone who
   * hit this on, say, the plan step: that screen is built from `pains`, and
   * emptying them without moving would leave a screen with nothing to show.
   */
  const startFresh = useCallback(() => {
    clearDraft();
    setD(emptyDraft());
    setResumed(false);
    setNav({ phase: 'flow', i: 0 });
  }, []);

  // Mirror answers to localStorage so a backgrounded webview doesn't lose ten
  // screens. Calendar URLs are deliberately excluded (see onboardingDraft.js).
  useEffect(() => { saveDraft(d); }, [d]);

  // A joiner's nav can point at a founder-only step (a resumed draft always
  // reopens at raw index 0, which is 'pains'). Rather than patching nav in
  // an effect, the EFFECTIVE index is derived at read time: the first
  // non-skipped step at or after the raw one. No-op for founders - nothing
  // is skipped, so it returns the index it was given.
  const effectiveI = useCallback((i) => {
    const hop = forwardFrom(i - 1, d);
    return hop.phase === 'flow' ? hop.i : i;
  }, [d]);

  // One shared timer: a fast double-tap on an auto-advance step must not queue
  // two jumps, and unmounting mid-delay must not advance a dead screen.
  const timer = useRef(null);
  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);
  useEffect(() => clearTimer, [clearTimer]);

  /** Merge a patch into the draft. Never replaces - back must be lossless. */
  const update = useCallback((patch) => {
    setD((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  }, []);

  const next = useCallback(() => {
    clearTimer();
    setNav((cur) => (cur.phase === 'flow' ? forwardFrom(effectiveI(cur.i), d) : cur));
  }, [clearTimer, d, effectiveI]);

  const back = useCallback(() => {
    clearTimer();
    if (nav.phase === 'flow') trackOnboardingStep(stepAt(effectiveI(nav.i)), 'back');
    setNav((cur) => {
      if (cur.phase === 'signup') return backFromSignup(d);
      if (cur.phase === 'login') return { phase: 'splash', i: 0 };
      if (cur.phase === 'flow') return backFrom(effectiveI(cur.i), d);
      return cur; // splash/done have nowhere back to go
    });
  }, [clearTimer, d, effectiveI, nav]);

  /** Skip is "forward without answering" - the answer stays unset. The
   *  wrapper only adds telemetry: which steps get skipped is exactly the
   *  kind of signal the funnel exists for. */
  const skip = useCallback(() => {
    if (nav.phase === 'flow') trackOnboardingStep(stepAt(effectiveI(nav.i)), 'skip');
    next();
  }, [nav, next, effectiveI]);

  /** Jump straight to a phase (splash -> flow, splash -> login, etc). */
  const goPhase = useCallback((phase, i = 0) => {
    clearTimer();
    setNav({ phase, i });
  }, [clearTimer]);

  /**
   * Select-and-advance for the shape and role steps: apply the patch, then move
   * on after 190ms so the selection is visibly registered first.
   */
  const pickAndAdvance = useCallback((patch) => {
    update(patch);
    clearTimer();
    timer.current = setTimeout(() => { timer.current = null; next(); }, AUTO_ADVANCE_MS);
  }, [update, next, clearTimer]);

  /** Called once the account exists and queued connections have been
   *  replayed. Straight to 'done' for everyone: the onboarding wall is
   *  MOTHBALLED under the free-app model (no wall on any platform -
   *  docs/spec-free-app-paid-assistant.md). PaywallScreen stays in the
   *  codebase unreferenced-by-flow, not deleted. */
  const finish = useCallback(() => {
    clearTimer();
    clearDraft();
    setNav({ phase: 'done', i: 0 });
  }, [clearTimer]);

  // Every consumer sees the effective index, never a skipped one.
  const shownI = nav.phase === 'flow' ? effectiveI(nav.i) : nav.i;

  // Anonymous drop-off telemetry: one 'enter' per screen actually shown.
  // Keyed on what the user SEES (phase, or the effective step inside the
  // flow) - fire-and-forget, and never this hook's problem if it fails.
  useEffect(() => {
    const shown = nav.phase === 'flow' ? stepAt(shownI) : nav.phase;
    if (shown) trackOnboardingStep(shown, 'enter');
  }, [nav.phase, shownI]);
  return {
    phase: nav.phase,
    i: shownI,
    step: stepAt(shownI),
    pct: progressPct(shownI, d),
    d, update,
    resumed, startFresh, dismissResume: () => setResumed(false),
    next, back, skip, goPhase, pickAndAdvance, finish,
    canAdvance: canAdvance(shownI, d),
  };
}
