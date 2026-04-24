/**
 * Platform-detection helpers — Phase 8.5 / iOS App Store submission.
 *
 * Centralising these so there's one place to flip if the Capacitor
 * isNativePlatform() contract ever changes. Used to gate iOS-only UI
 * behaviour around subscription billing — Apple Review Guideline 3.1.1
 * prohibits selling digital subscriptions inside the app without using
 * Apple's IAP, and Apple's Anti-Steering rule prohibits linking to an
 * external payment page from inside the app.
 *
 * Our compromise (documented in App Store review notes): subscriptions
 * are managed on the web. On iOS we:
 *   • don't render any Subscribe / Manage-subscription buttons,
 *   • don't include tappable links to housemait.com,
 *   • do surface the domain name as plain text so users who want to
 *     subscribe know where to go.
 */

import { Capacitor } from '@capacitor/core';

/**
 * True when the app is running as a Capacitor-wrapped native iOS binary.
 * False for web (even when viewed in Safari on iPhone) and Android.
 */
export function isIos() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  } catch {
    // Defensive — Capacitor should always be available, but if this
    // helper is used during SSR or in a test that doesn't shim it,
    // treat as "not iOS" (safer default — shows full subscribe flow).
    return false;
  }
}

/** True when running as any Capacitor-wrapped native binary (iOS or Android). */
export function isNative() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
