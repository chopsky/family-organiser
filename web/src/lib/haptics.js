/**
 * Haptic feedback helpers - iOS only.
 *
 * Wraps @capacitor/haptics so callers don't have to import + null-check
 * + try/catch on every press. Three semantic levels:
 *
 *   tap()        - quick light tick. Use for button presses, list-row
 *                  taps, bottom-tab switches. Cheap and frequent.
 *   confirm()    - medium impact for committed actions. Toggling a
 *                  task complete, marking shopping done, saving.
 *   warn()       - heavier "are you sure" feedback. Reserve for
 *                  destructive confirmations (delete account, remove
 *                  household member, etc).
 *
 * All three are no-ops on web. The plugin itself silently no-ops on
 * Android too if the device lacks Taptic Engine equivalent.
 */

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export async function tap() {
  if (!isNative()) return;
  try { await Haptics.impact({ style: ImpactStyle.Light }); } catch { /* no-op */ }
}

export async function confirm() {
  if (!isNative()) return;
  try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch { /* no-op */ }
}

export async function warn() {
  if (!isNative()) return;
  try { await Haptics.notification({ type: NotificationType.Warning }); } catch { /* no-op */ }
}

/** Selection-change haptic (used by SwiftUI Picker / segmented control).
 *  Right for slider tick-overs, picker scroll, tab-bar selection that
 *  isn't a "tap" so much as a "lock in this row". */
export async function select() {
  if (!isNative()) return;
  try { await Haptics.selectionChanged(); } catch { /* no-op */ }
}
