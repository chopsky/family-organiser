/**
 * Share via the iOS share sheet (Messages, AirDrop, Mail, Notes,
 * WhatsApp, etc.) with a Web Share API fallback for browsers, and
 * clipboard-copy as the last resort.
 *
 * Use to share:
 *   • a shopping list as plain text
 *   • a single event ("Garden bin · Mon 18:00")
 *   • a meal plan summary
 *
 * Returns true if the share completed (or fell back to clipboard
 * successfully), false if the user cancelled or it failed.
 */

import { Capacitor } from '@capacitor/core';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * @param {object} opts
 * @param {string} [opts.title]   - Optional title (shown by some
 *                                  share targets, ignored by others)
 * @param {string} opts.text      - The body of the share. Required.
 * @param {string} [opts.url]     - Optional URL to attach.
 * @param {string} [opts.dialogTitle] - iOS-only sheet title
 * @returns {Promise<boolean>}
 */
export async function share({ title, text, url, dialogTitle } = {}) {
  if (!text && !url) return false;

  // 1. iOS native share sheet - preferred path
  if (isNative()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: title || 'Housemait',
        text: text || '',
        url: url || undefined,
        dialogTitle: dialogTitle || 'Share via',
      });
      return true;
    } catch (err) {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes('cancel') || msg.includes('dismiss')) return false;
      console.warn('[share] native share failed, falling back:', err?.message || err);
      // Fall through to web fallbacks
    }
  }

  // 2. Web Share API - supported on iOS Safari + Chrome Android
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return true;
    } catch (err) {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes('cancel') || msg.includes('abort')) return false;
      // Fall through to clipboard
    }
  }

  // 3. Clipboard fallback - works on every desktop browser
  try {
    const body = [title, text, url].filter(Boolean).join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(body);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}
