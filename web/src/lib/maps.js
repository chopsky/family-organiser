/**
 * Open an event's location in the platform's maps app.
 *
 * On iOS, maps.apple.com is a universal link - the webview hands it
 * straight to Apple Maps (and CarPlay picks the destination up from
 * there). Android and desktop get Google Maps, which is the default
 * maps handler for both. Feature request from a customer who wanted
 * the native-calendar "tap the address, start driving" flow
 * (2026-08-15).
 */
import { Capacitor } from '@capacitor/core';

export function mapsUrl(address) {
  const q = encodeURIComponent((address || '').trim());
  if (!q) return null;
  const isApple = Capacitor.getPlatform() === 'ios'
    || /iPhone|iPad|Macintosh/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return isApple
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function openInMaps(address) {
  const url = mapsUrl(address);
  if (url) window.open(url, '_blank', 'noopener');
}
