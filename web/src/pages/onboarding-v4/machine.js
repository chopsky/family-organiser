/**
 * Onboarding v4 flow machine — pure transition logic.
 *
 * Kept free of React so the navigation rules are readable in one place and can
 * be reasoned about (and later unit-tested) without rendering anything. The
 * hook in useOnboardingFlow.js composes these.
 *
 * Spec rules encoded here:
 *   - phase: splash | flow | login | signup | done
 *   - advancing past the LAST step goes to phase 'signup', not step 9
 *   - back from step 0 returns to the splash, never to a blank screen
 *   - back NEVER clears data; the draft is the single source of truth
 *   - shape + role auto-advance 190ms after selection (no CTA)
 *   - only you / house / signup are required; everything else has a skip
 */
import { STEPS } from './flow';

/** Per-step metadata. `skipLabel` null = the step cannot be skipped. */
export const STEP_META = {
  // No skip (founder call 2026-08-21): the picker is what personalises
  // the plan screen AND the paywall, so an empty answer costs the two
  // screens that do the most selling. canAdvance already requires one.
  pains:     { required: true,  autoAdvance: false, skipLabel: null },
  plan:      { required: false, autoAdvance: false, skipLabel: null },  // nothing to skip; CTA only
  shape:     { required: false, autoAdvance: true,  skipLabel: 'Skip' },
  you:       { required: true,  autoAdvance: false, skipLabel: null },
  role:      { required: false, autoAdvance: true,  skipLabel: 'Skip for now' },
  house:     { required: true,  autoAdvance: false, skipLabel: null },
  cals:      { required: false, autoAdvance: false, skipLabel: "I'll do this later" },
  ask:       { required: false, autoAdvance: false, skipLabel: "I don't use WhatsApp" },
  inbox:     { required: false, autoAdvance: false, skipLabel: 'Skip for now' },
  reminders: { required: false, autoAdvance: false, skipLabel: 'Maybe later' },
};

/** Auto-advance delay, per spec. Long enough to see the selection land. */
export const AUTO_ADVANCE_MS = 190;

export const stepAt = (i) => STEPS[i] ?? null;
export const metaAt = (i) => STEP_META[stepAt(i)] ?? null;
export const isRequired = (i) => Boolean(metaAt(i)?.required);
export const skipLabelAt = (i) => metaAt(i)?.skipLabel ?? null;
export const autoAdvances = (i) => Boolean(metaAt(i)?.autoAdvance);

/**
 * Steps that only make sense for someone FOUNDING a household. A joiner
 * (arrived with an invite code - `d.joining` set) skips them: pains/plan
 * personalise a paywall joiners never see, shape would duplicate members the
 * founder already created, and house naming + inbox claiming are founder
 * acts. Navigation hops over them; the joiner walks you → role → cals →
 * ask → reminders.
 */
const FOUNDER_ONLY_STEPS = new Set(['pains', 'plan', 'shape', 'house', 'inbox']);
const isSkipped = (i, d) => Boolean(d?.joining) && FOUNDER_ONLY_STEPS.has(stepAt(i));
const activeSteps = (d) => (d?.joining ? STEPS.filter((s) => !FOUNDER_ONLY_STEPS.has(s)) : STEPS);

/**
 * Progress percentage. Spec: `pct = round(i / 9 * 100)` - denominator is the
 * number of steps, so the last step reads 8/9 and the sign-up card shows a full
 * bar of its own. The calendar sub-screen deliberately does not advance `i`, so
 * the bar holds at the calendar step's value rather than jumping to 100%.
 * For a joiner both position and denominator count only their five steps.
 */
export const progressPct = (i, d) => {
  const list = activeSteps(d);
  const pos = Math.max(0, list.indexOf(stepAt(i)));
  return Math.round((pos / list.length) * 100);
};

/**
 * Where "forward" goes from step i. Past the last step the flow leaves the
 * step frame entirely and becomes the sign-up card. Founder-only steps are
 * hopped over for joiners.
 * @returns {{phase: string, i: number}}
 */
export function forwardFrom(i, d) {
  let next = i + 1;
  while (next < STEPS.length && isSkipped(next, d)) next++;
  if (next >= STEPS.length) return { phase: 'signup', i };
  return { phase: 'flow', i: next };
}

/**
 * Where "back" goes from step i. From the first step this returns to the
 * splash - the flow must never strand someone on an empty screen.
 * @returns {{phase: string, i: number}}
 */
export function backFrom(i, d) {
  let prev = i - 1;
  while (prev >= 0 && isSkipped(prev, d)) prev--;
  if (prev < 0) return { phase: 'splash', i: 0 };
  return { phase: 'flow', i: prev };
}

/**
 * Back out of the sign-up card returns to the LAST step, so someone who wants
 * to change an answer before creating an account can.
 */
export function backFromSignup(d) {
  let last = STEPS.length - 1;
  while (last > 0 && isSkipped(last, d)) last--;
  return { phase: 'flow', i: last };
}

/**
 * Can the CTA on step i fire, given the draft? Only the two required steps
 * gate on content; the rest are always passable (that's the point of the skip
 * paths). `plan` additionally waits for its script, which the screen owns.
 */
export function canAdvance(i, d) {
  const step = stepAt(i);
  if (step === 'you') return Boolean((d.you || '').trim());
  if (step === 'house') return Boolean((d.house || '').trim());
  if (step === 'pains') return (d.pains || []).length > 0;
  return true;
}
