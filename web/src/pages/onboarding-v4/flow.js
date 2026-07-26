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
export const STEPS = ['pains', 'plan', 'shape', 'you', 'role', 'house', 'cals', 'ask', 'reminders'];

export const PHASES = ['splash', 'flow', 'login', 'signup', 'done'];

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
