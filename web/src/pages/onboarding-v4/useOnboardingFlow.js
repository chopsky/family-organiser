import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDraft, emptyDraft, isDraftEmpty, loadDraft, saveDraft } from '../../lib/onboardingDraft';
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
    setNav((cur) => (cur.phase === 'flow' ? forwardFrom(cur.i) : cur));
  }, [clearTimer]);

  const back = useCallback(() => {
    clearTimer();
    setNav((cur) => {
      if (cur.phase === 'signup') return backFromSignup();
      if (cur.phase === 'login') return { phase: 'splash', i: 0 };
      if (cur.phase === 'flow') return backFrom(cur.i);
      return cur; // splash/done have nowhere back to go
    });
  }, [clearTimer]);

  /** Skip is just "forward without answering" - the answer stays unset. */
  const skip = next;

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

  /** Called once the account exists and queued connections have been replayed. */
  const finish = useCallback(() => {
    clearTimer();
    clearDraft();
    setNav({ phase: 'done', i: 0 });
  }, [clearTimer]);

  return {
    phase: nav.phase,
    i: nav.i,
    step: stepAt(nav.i),
    pct: progressPct(nav.i),
    d, update,
    resumed, startFresh, dismissResume: () => setResumed(false),
    next, back, skip, goPhase, pickAndAdvance, finish,
    canAdvance: canAdvance(nav.i, d),
  };
}
