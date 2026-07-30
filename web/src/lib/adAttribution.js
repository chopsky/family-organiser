/**
 * Apple Ads install attribution — capture and hand-off.
 *
 * On first authenticated launch of the iOS app, ask the AdAttribution native
 * plugin for an AdServices token and post it to the backend, which redeems
 * it with Apple and stamps the answer (attributed campaign, or organic) on
 * the user. Ad installs stop being invisible in the cohort analytics.
 *
 * Silence rules, in order:
 *   - Not the native iOS app (web, Android, desktop): nothing to do —
 *     AdServices is Apple-only.
 *   - Old app build without the plugin: the call throws, we stay silent.
 *     The JS ships ahead of the native build on purpose (frozen-dist).
 *   - No token (simulator, iOS < 14.3, no ad activity): nothing to report.
 *
 * The device marks itself done ONLY when the server confirms `stored` — a
 * pending migration or an Apple outage answers stored:false and we simply
 * try again next launch with a fresh token (tokens expire after 24h, so
 * retrying with the old one would be pointless anyway).
 */
import { useEffect } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import api from './api';

const AdAttribution = registerPlugin('AdAttribution');

// Per DEVICE, deliberately: attribution belongs to the install, and the
// first account that signs in on the device is who the install converted
// into. A second family member sharing the phone adds no new install story.
const SENT_KEY = 'housemait_adservices_done';

export async function maybeSendAdAttribution(userId) {
  try {
    if (!userId) return;
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'ios') return;
    if (localStorage.getItem(SENT_KEY)) return;

    let token = null;
    try {
      ({ token } = await AdAttribution.getAttributionToken());
    } catch {
      return; // plugin not in this build yet
    }
    if (!token) return;

    const { data } = await api.post('/attribution/adservices', { token });
    if (data?.stored) localStorage.setItem(SENT_KEY, '1');
  } catch {
    // Network blip - next launch retries with a fresh token.
  }
}

/** Fire-once-per-user hook; lives next to usePushNotifications in Layout. */
export function useAdAttribution(user) {
  useEffect(() => {
    if (user?.id) maybeSendAdAttribution(user.id);
  }, [user?.id]);
}
