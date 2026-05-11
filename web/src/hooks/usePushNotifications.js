import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import api from '../lib/api';

/**
 * Registers for push notifications on iOS (Capacitor) and sends the
 * device token to the backend. No-ops silently on web / non-Capacitor.
 *
 * Call once from a top-level authenticated component (e.g. Layout).
 */
export default function usePushNotifications(user) {
  const registered = useRef(false);

  useEffect(() => {
    if (!user?.id || registered.current) return;
    if (!Capacitor.isNativePlatform()) return;

    let cleanup = () => {};

    (async () => {
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // Check / request permission
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') return;

        // Listen for registration success
        const regListener = await PushNotifications.addListener('registration', async (token) => {
          try {
            await api.post('/notifications/register-device', {
              token: token.value,
              platform: 'ios',
            });
            registered.current = true;
          } catch (err) {
            console.warn('Failed to register device token:', err);
          }
        });

        // Listen for registration errors
        const errListener = await PushNotifications.addListener('registrationError', (err) => {
          console.warn('Push registration error:', err);
        });

        // Listen for incoming notifications while app is open
        const fgListener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          // Could show an in-app toast here in the future
          console.log('Push received in foreground:', notification);
        });

        // Listen for notification tap (app opened from notification)
        const tapListener = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action.notification?.data;
          if (data?.url) {
            window.location.href = data.url;
          }
        });

        cleanup = () => {
          regListener.remove();
          errListener.remove();
          fgListener.remove();
          tapListener.remove();
        };

        // Register with APNs
        await PushNotifications.register();
      } catch (err) {
        console.warn('Push notifications not available:', err);
      }
    })();

    return () => cleanup();
  }, [user?.id]);
}
