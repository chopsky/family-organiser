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
        console.log('[push] hook running for user', user.id);
        const { PushNotifications } = await import('@capacitor/push-notifications');

        // Check / request permission
        let perm = await PushNotifications.checkPermissions();
        console.log('[push] initial permission:', perm.receive);
        if (perm.receive === 'prompt') {
          perm = await PushNotifications.requestPermissions();
          console.log('[push] permission after prompt:', perm.receive);
        }
        if (perm.receive !== 'granted') {
          console.log('[push] permission not granted, bailing');
          return;
        }

        // Listen for registration success
        const regListener = await PushNotifications.addListener('registration', async (token) => {
          console.log('[push] got token from APNs, length:', token.value?.length);
          try {
            await api.post('/notifications/register-device', {
              token: token.value,
              platform: 'ios',
            });
            console.log('[push] token posted to server successfully');
            registered.current = true;
          } catch (err) {
            console.warn('[push] failed to POST token to server:', err.message, err.response?.status, err.response?.data);
          }
        });

        // Listen for registration errors
        const errListener = await PushNotifications.addListener('registrationError', (err) => {
          console.warn('[push] APNs registration error:', JSON.stringify(err));
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
        console.log('[push] calling register()...');
        await PushNotifications.register();
        console.log('[push] register() resolved (waiting for registration event)');
      } catch (err) {
        console.warn('Push notifications not available:', err);
      }
    })();

    return () => cleanup();
  }, [user?.id]);
}
