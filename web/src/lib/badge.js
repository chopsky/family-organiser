/**
 * App-icon badge wrapper — iOS only.
 *
 * Sets or clears the red number badge on the Housemait home-screen
 * icon. Use to surface "stuff needing attention" without nagging:
 *
 *   • Overdue tasks count
 *   • Today's upcoming events (optional — usually noisy)
 *
 * Calls are gated by isNative() so the web bundle is unchanged. The
 * native plugin handles permission internally — if the user hasn't
 * granted notification permission, setting a badge silently does
 * nothing rather than erroring.
 *
 * On web: no-op.
 *
 * NOTE: the iOS app badge ALSO updates when a push notification with
 * `badge` field arrives. Both paths can co-exist; the most recent
 * write wins.
 */

import { Capacitor } from '@capacitor/core';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export async function setBadgeCount(count) {
  if (!isNative()) return;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  try {
    const { Badge } = await import('@capawesome/capacitor-badge');
    if (n === 0) {
      await Badge.clear();
    } else {
      await Badge.set({ count: n });
    }
  } catch (err) {
    console.warn('[badge] setBadgeCount failed:', err?.message || err);
  }
}

export async function clearBadge() {
  if (!isNative()) return;
  try {
    const { Badge } = await import('@capawesome/capacitor-badge');
    await Badge.clear();
  } catch (err) {
    console.warn('[badge] clearBadge failed:', err?.message || err);
  }
}
