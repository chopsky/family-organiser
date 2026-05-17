/**
 * Native photo-picker wrapper with HTML-input fallback.
 *
 * On iOS native: opens the full-screen iOS photo picker (album
 * browser + edit/crop sheet + native "Take Photo" affordance).
 * Indistinguishable from how the system Photos / Mail / Messages
 * apps prompt for an image.
 *
 * On web: falls back to a hidden `<input type="file" accept="image/*">`
 * click — same browser file picker we had before.
 *
 * Returns a Blob in both cases so the caller can hand it to the same
 * FormData / upload path it already uses for `<input>` selections.
 *
 * Usage:
 *
 *   <button onClick={async () => {
 *     const file = await pickPhoto({ source: 'prompt' });
 *     if (file) await api.post('/avatar', new FormData(...));
 *   }}>Change photo</button>
 *
 * If the user cancels (closes the picker), returns null.
 */

import { Capacitor } from '@capacitor/core';

function isNative() {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * Open the photo picker.
 *
 * @param {object} opts
 * @param {'prompt'|'camera'|'photos'} [opts.source='prompt']
 *   - 'prompt': iOS shows a chooser ("Take Photo" / "Choose from Library").
 *   - 'camera': open straight to the camera.
 *   - 'photos': open straight to the photo library.
 * @param {number} [opts.quality=85] - JPEG quality 0-100.
 * @param {boolean} [opts.allowEditing=true] - iOS in-picker crop sheet.
 * @returns {Promise<Blob|null>} a Blob (or null if cancelled)
 */
export async function pickPhoto({
  source = 'prompt',
  quality = 85,
  allowEditing = true,
} = {}) {
  if (isNative()) {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const sourceMap = {
        prompt: CameraSource.Prompt,
        camera: CameraSource.Camera,
        photos: CameraSource.Photos,
      };
      const photo = await Camera.getPhoto({
        quality,
        allowEditing,
        resultType: CameraResultType.Uri,
        source: sourceMap[source] || CameraSource.Prompt,
      });
      // Camera plugin returns a webPath (file://… on iOS converted to
      // a usable URL); fetch it back as a Blob so the caller can use
      // FormData like the web `<input>` flow does.
      if (!photo?.webPath) return null;
      const res = await fetch(photo.webPath);
      return await res.blob();
    } catch (err) {
      // The plugin throws "User cancelled photos app" on close. Map to null.
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes('cancel') || msg.includes('dismiss')) return null;
      console.warn('[photo-picker] native picker failed, falling back:', err?.message || err);
      // Fall through to the web input fallback
    }
  }
  // Web fallback — synthesize a hidden file input + wait for change.
  return pickViaHiddenInput();
}

function pickViaHiddenInput() {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    let settled = false;
    function settle(file) {
      if (settled) return;
      settled = true;
      try { document.body.removeChild(input); } catch { /* no-op */ }
      resolve(file || null);
    }
    input.addEventListener('change', () => settle(input.files?.[0] || null));
    // No reliable "cancel" event in browsers — settle on focus return.
    // (Edge case: user opens picker, never picks, never returns. We
    // accept the unresolved promise; the picker can be re-opened.)
    document.body.appendChild(input);
    input.click();
  });
}
