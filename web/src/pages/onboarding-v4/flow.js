/**
 * Onboarding v4 flow constants.
 *
 * Kept out of the component file so Fast Refresh keeps working (a component
 * module must only export components) and so the platform gate can be applied
 * at the route without putting a conditional return above the hooks.
 */
import { Capacitor } from '@capacitor/core';

// Spec: STEPS drives the progress bar; advancing past the last sets phase
// 'signup'. The per-provider calendar connect view lives INSIDE the 'cals'
// step, deliberately NOT in this array, so progress doesn't jump to 100%.
// 'inbox' sits between 'cals' and 'reminders': the send-it-to-us
// channels cluster at the end of setup. progressPct divides by STEPS.length, so the
// denominator renumbers itself.
// 'kids' shows only when the shape answer says children are in the picture
// (kids / single / multigen) - machine.js hops it otherwise. It exists
// because the shape answer used to be collected and then DISCARDED: a family
// tapped "Family with kids" and the app still treated them as childless,
// hiding Child Mode, School and the star chart behind hasChildren gates
// until someone wandered into Family Setup (and the App Review 2.3.6
// rejection hit exactly that blindness).
// 'ask' (the pre-auth WhatsApp step) was REMOVED 2026-08-28: it could only
// record intent (no account exists yet to bind a number to), the button read
// as if it had connected, and ~70% of households never completed the deferred
// pairing. The real, live pairing now happens in the post-auth 'whatsapp'
// PHASE, between sign-up and the celebration - where the code exchange can
// actually run and the UI can tell the truth.
export const STEPS = ['pains', 'plan', 'shape', 'you', 'role', 'kids', 'house', 'cals', 'inbox', 'reminders'];

export const PHASES = ['splash', 'flow', 'login', 'signup', 'whatsapp', 'done'];

/**
 * v4 is iOS/Android ONLY for now (founder decision: app first, web later).
 *
 * There is one codebase - the native apps ship a frozen snapshot of this same
 * bundle - so "app only" is a runtime gate, not a separate project. At cutover
 * /signup becomes `native ? <OnboardingV4/> : <OnboardingFlow/>`, and web flips
 * over once v4 has proven itself on mobile.
 *
 * import.meta.env.DEV keeps it reachable in the local browser so the flow can
 * be built and verified without an App Store round trip.
 */
export const V4_ALLOWED = Capacitor.isNativePlatform() || import.meta.env.DEV;
