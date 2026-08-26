/**
 * Anonymous step telemetry for the v4 onboarding flow.
 *
 * The pre-account steps were invisible: iOS creates the account at the END
 * of the flow, so the 30-day funnel read "100%" signup-to-onboarded purely
 * because everyone who quit at "name your house" never existed in the data.
 * This mints one random id per device (localStorage, no PII, no account
 * link) and fire-and-forgets a row per step transition.
 *
 * Contract mirrors the server's: telemetry must never break the flow it
 * measures. Every path here swallows its own failures.
 */
import { Capacitor } from '@capacitor/core';
import api from './api';

const KEY = 'housemait_onboarding_anon';

function anonId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null; // private browsing - events just don't send
  }
}

// One event per (step, action) per pageload: resumes re-enter the same
// steps and would double-count reach otherwise. Reach is per-journey
// anyway (the server aggregates by furthest step), so suppressing repeats
// only reduces noise, never signal.
const sent = new Set();

export function trackOnboardingStep(step, action = 'enter') {
  try {
    const id = anonId();
    if (!id || !step) return;
    const key = `${step}:${action}`;
    if (sent.has(key)) return;
    sent.add(key);
    api.post('/telemetry/onboarding', {
      anonId: id,
      step,
      action,
      platform: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web-dev',
    }).catch(() => {});
  } catch { /* never the flow's problem */ }
}
