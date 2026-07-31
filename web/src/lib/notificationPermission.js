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

/**
 * Read the current permission WITHOUT prompting.
 *
 * requestNotificationPermission() below can surface the OS dialog, which is
 * one-shot — so anything that merely wants to *know* the answer (the home
 * screen's setup nudges, for one) has to ask this instead. Spending the single
 * prompt on a render would be unforgivable.
 *
 * Returns 'granted' | 'denied' | 'prompt' | 'unavailable'. Web is always
 * 'unavailable': there is no web push in this app, so no permission exists to
 * hold. Callers must treat 'unavailable' as "this task cannot be completed
 * here" rather than as a refusal.
 */
export async function getNotificationPermission() {
  if (!Capacitor.isNativePlatform()) return 'unavailable';
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'granted') return 'granted';
    if (perm.receive === 'denied') return 'denied';
    return 'prompt';
  } catch (err) {
    console.warn('Notification permission check failed:', err?.message || err);
    return 'unavailable';
  }
}

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
  // iOS shows the permission dialog once per install, ever. On a device that
  // answered it before (a previous account, an earlier build), request
  // resolves silently with the old answer - and a silent grant looks exactly
  // like a broken button. Detect that case and SAY it, so the person who
  // tapped "Turn on nudges" and saw no dialog knows the step worked.
  const before = await getNotificationPermission();
  const result = await requestNotificationPermission();
  if (result === 'granted') {
    return {
      granted: true,
      note: before === 'granted' ? 'Nudges are already on for this phone. ✓' : '',
    };
  }
  if (result === 'denied') {
    // Never a dead end. The flow moves on either way; this just says where the
    // switch lives now that the one-shot prompt is spent.
    return { granted: false, note: 'No problem — you can turn nudges on any time in Settings.' };
  }
  // Not a native build: there is no OS prompt, so claiming "on" would be a lie.
  return { granted: false, note: 'Nudges are an app feature — you\u2019ll be asked once you\u2019re on your phone.' };
}
