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
