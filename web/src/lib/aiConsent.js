/**
 * AI-processing consent (App Review 5.1.1(i)/5.1.2(i), build 41 rejection).
 *
 * Apple requires the app itself to disclose what is sent to third-party AI
 * services, name them, and ask permission BEFORE sending - the privacy
 * policy alone is explicitly not sufficient. This records that the user
 * saw the AiConsentNotice and agreed, per device (localStorage, same
 * pattern as the free-tier welcome flag): re-asking on a new device is a
 * feature for a consent record, not a bug.
 *
 * Gated surfaces: the AI chat panel (text, pasted photos/PDFs) and the
 * school term-dates import sheet (website/PDF/photo extraction). The
 * house inbox has its own consent moment - approving a sender in
 * Settings, where the metering disclosure lives.
 */

const KEY = 'housemait_ai_consent';

export function hasAiConsent() {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    // Storage unavailable (private mode) - treat as not yet consented so
    // the notice shows; agreeing still lets the session proceed.
    return false;
  }
}

export function recordAiConsent() {
  try {
    localStorage.setItem(KEY, 'true');
  } catch {
    // Unrecordable consent still stands for this session - callers keep
    // their own in-memory state after calling this.
  }
}

// Session-scoped "Not now" on the app-level modal: it comes back next
// session (and immediately on any explicit AI action), never nags twice
// in one sitting.
const LATER_KEY = 'housemait_ai_consent_later';

export function consentDeferredThisSession() {
  try { return sessionStorage.getItem(LATER_KEY) === '1'; } catch { return false; }
}
export function deferConsentThisSession() {
  try { sessionStorage.setItem(LATER_KEY, '1'); } catch { /* per-session nicety only */ }
}

// The app-level gate (AiConsentGate, mounted in Layout) registers here so
// AI features anywhere in the shell can ask imperatively:
//   if (!(await ensureAiConsent())) return;
// Resolves true immediately when consent already stands; otherwise opens
// the modal and resolves with the user's answer. With no gate mounted
// (never the case inside the app shell) it refuses rather than leaks.
let askGate = null;
export function registerConsentGate(fn) {
  askGate = fn;
  return () => { if (askGate === fn) askGate = null; };
}
export function ensureAiConsent() {
  if (hasAiConsent()) return Promise.resolve(true);
  if (!askGate) return Promise.resolve(false);
  return askGate();
}
