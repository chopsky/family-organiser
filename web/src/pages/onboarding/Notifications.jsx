/**
 * Step 5 (iOS only) — request push notification permission.
 *
 * Triggers the same Capacitor PushNotifications flow the app-wide
 * usePushNotifications hook uses, but does it in response to a deliberate
 * user tap rather than silently at mount. That's kinder UX (the OS prompt
 * lands in context) and ensures the user has a moment of intent before the
 * permission dialog appears.
 *
 * If the user already granted permission earlier (e.g. they rerun the
 * wizard from settings later), the step fast-forwards instead of
 * re-prompting.
 */

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import api from '../../lib/api';
import { serifHeading, serifHeadingStyle, kicker, primaryBtn, skipLink } from './_styles';

export default function Notifications({ next, setError }) {
  const [status, setStatus] = useState('unknown'); // unknown | prompt | granted | denied | working
  const [requesting, setRequesting] = useState(false);

  // Peek at the current permission state on mount so the CTA wording matches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Capacitor.isNativePlatform()) {
        if (!cancelled) setStatus('web');
        return;
      }
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const perm = await PushNotifications.checkPermissions();
        if (!cancelled) setStatus(perm.receive || 'prompt');
      } catch (err) {
        console.warn('Push check failed:', err);
        if (!cancelled) setStatus('prompt');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function enable() {
    if (requesting) return;
    setRequesting(true);
    setStatus('working');
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        setStatus(perm.receive || 'denied');
        setRequesting(false);
        return;
      }

      // Wire the listener BEFORE calling register() so we catch the token.
      const regListener = await PushNotifications.addListener('registration', async (token) => {
        try {
          await api.post('/notifications/register-device', {
            token: token.value,
            platform: 'ios',
          });
        } catch (err) {
          console.warn('[onboarding] register-device failed:', err);
        } finally {
          regListener.remove();
          setStatus('granted');
          setRequesting(false);
          next();
        }
      });

      await PushNotifications.register();
      // Safety timeout: if APNs doesn't call back within 6s, move on anyway.
      // The usePushNotifications hook at the top of Layout will pick up the
      // registration later and retry the device token send.
      setTimeout(() => {
        if (requesting) {
          setRequesting(false);
          setStatus('granted');
          next();
        }
      }, 6000);
    } catch (err) {
      console.warn('[onboarding] enable push failed:', err);
      setError('Could not enable notifications — you can turn them on later in Settings.');
      setStatus('denied');
      setRequesting(false);
    }
  }

  return (
    <div>
      <div className="text-center">
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Step 3 — notifications
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          Gentle <i>nudges</i>, when they matter.
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          Housemait sends a quick notification when someone in the family adds or
          completes a task, shares a shopping item, or adds to the calendar.
          Nothing marketing, just the stuff you'd miss otherwise.
        </p>
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        {status === 'granted' ? (
          <>
            <p className="text-sm text-success font-semibold">✓ Notifications already enabled</p>
            <button type="button" onClick={next} className={primaryBtn}>
              Continue →
            </button>
          </>
        ) : status === 'denied' ? (
          <>
            <p className="text-sm text-cocoa max-w-md text-center">
              Notifications were declined. You can turn them on later in your
              iPhone's Settings → Notifications → Housemait.
            </p>
            <button type="button" onClick={next} className={primaryBtn}>
              Continue →
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={enable}
              disabled={requesting}
              className={primaryBtn}
            >
              {requesting ? 'Enabling…' : 'Enable notifications'}
            </button>
            <button type="button" onClick={next} className={skipLink}>
              Skip for now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
