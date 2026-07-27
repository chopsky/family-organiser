/**
 * Notification permission, asked once and honestly.
 *
 * The OS prompt is one-shot: iOS shows it exactly once per install, and a
 * "Don't Allow" can only be undone in Settings. So onboarding shows two real
 * example notifications first and only then triggers this — the dialog becomes
 * a formality rather than a gamble.
 *
 * Permission is device-level and needs no account, which is why this can run
 * at step 10 while sign-up is still at step 11. Registering the device TOKEN
 * does need an account, and already happens after login via
 * hooks/usePushNotifications — so this asks, and that registers.
 *
 * Returns one of:
 *   'granted'      the OS prompt was accepted
 *   'denied'       declined, or previously declined (no prompt was shown)
 *   'unavailable'  not a native build — there is no OS prompt to show
 */
import { Capacitor } from '@capacitor/core';

export async function requestNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return 'unavailable';

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // checkPermissions first: if the user already decided, requestPermissions
    // resolves instantly with the old answer and shows nothing, so treating a
    // silent 'denied' as a fresh refusal would be wrong.
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    return perm.receive === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    // A missing plugin or a failed bridge call must not strand the flow on a
    // screen the user cannot leave.
    console.warn('Notification permission request failed:', err?.message || err);
    return 'unavailable';
  }
}

/**
 * Ask the OS, and translate the answer into what the flow should record and
 * say. Returns { granted, note } — never throws, and never claims a permission
 * it did not get.
 *
 * Lives here rather than beside the screen because it is permission logic, not
 * presentation, and the screen file must export only components.
 */
export async function askForNudges() {
  const result = await requestNotificationPermission();
  if (result === 'granted') return { granted: true, note: '' };
  if (result === 'denied') {
    // Never a dead end. The flow moves on either way; this just says where the
    // switch lives now that the one-shot prompt is spent.
    return { granted: false, note: 'No problem — you can turn nudges on any time in Settings.' };
  }
  // Not a native build: there is no OS prompt, so claiming "on" would be a lie.
  return { granted: false, note: 'Nudges are an app feature — you\u2019ll be asked once you\u2019re on your phone.' };
}
