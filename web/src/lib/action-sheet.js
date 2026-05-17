/**
 * Native iOS action sheet wrapper with a browser confirm() fallback.
 *
 * Use for irreversible / two-step actions where a generic Yes/Cancel
 * modal is overkill but you want the user to commit explicitly:
 *
 *   • Delete event / task / shopping item
 *   • Remove member from household
 *   • Cancel tracked subscription
 *   • "Are you sure?" before bulk operations
 *
 * On iOS native: triggers an Apple-style sliding action sheet from
 * the bottom with red-tinted "Destructive" styling for delete-flavoured
 * actions. Feels indistinguishable from the system Mail app.
 *
 * On web: falls back to window.confirm() so the same call site works
 * in both contexts. The destructive action becomes the "OK" button,
 * cancel becomes "Cancel".
 *
 * Returns true if the user confirmed the destructive action, false
 * if they cancelled (or anything went wrong).
 */

import { Capacitor } from '@capacitor/core';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * Show a confirmation action sheet for a destructive action.
 *
 * @param {object} opts
 * @param {string} opts.title       - Sheet header (e.g. "Delete this event?")
 * @param {string} [opts.message]   - Sub-text explaining the consequence
 * @param {string} [opts.confirmLabel='Delete'] - Red destructive button label
 * @param {string} [opts.cancelLabel='Cancel']  - Cancel button label
 * @returns {Promise<boolean>}      - true if confirmed
 */
export async function confirmDestructive({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
} = {}) {
  if (isNative()) {
    try {
      const { ActionSheet, ActionSheetButtonStyle } = await import('@capacitor/action-sheet');
      const result = await ActionSheet.showActions({
        title,
        message,
        options: [
          { title: confirmLabel, style: ActionSheetButtonStyle.Destructive },
          { title: cancelLabel,  style: ActionSheetButtonStyle.Cancel },
        ],
      });
      // index 0 = destructive, 1 = cancel; user dismissal returns -1 in
      // some plugin versions, treat anything not exactly 0 as cancel.
      return result?.index === 0;
    } catch (err) {
      console.warn('[action-sheet] native action sheet failed, falling back:', err?.message || err);
      // Fall through to confirm()
    }
  }
  const prompt = message ? `${title}\n\n${message}` : title;
  // eslint-disable-next-line no-alert
  return typeof window !== 'undefined' && window.confirm(prompt);
}
