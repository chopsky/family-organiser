// Resize/compress an image File (or Blob) on the client before upload, so we
// don't ship multi-megabyte phone photos for avatars / household pictures that
// only ever render small. Scales the longest side down to `maxDim` (never
// upscales), re-encodes as JPEG at `quality`, and returns a File. Falls back to
// the original file whenever anything is unsupported or fails, so uploads never
// break.
export default async function resizeImage(file, { maxDim = 640, quality = 0.82 } = {}) {
  if (!file) return file;
  // Only touch raster images; leave non-images and GIFs (would lose animation).
  if (file.type && (!file.type.startsWith('image/') || file.type === 'image/gif')) return file;
  try {
    const bitmap = await loadBitmap(file);
    const srcW = bitmap.naturalWidth || bitmap.width;
    const srcH = bitmap.naturalHeight || bitmap.height;
    if (!srcW || !srcH) { closeBitmap(bitmap); return file; }
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    closeBitmap(bitmap);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return file;
    // If we didn't shrink the dimensions and re-encoding made it bigger
    // (e.g. a small PNG), keep the original.
    if (scale === 1 && blob.size >= file.size) return file;
    const name = `${(file.name || 'photo').replace(/\.[^.]+$/, '')}.jpg`;
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

// createImageBitmap honours EXIF orientation on modern browsers + iOS WKWebView;
// fall back to an <img> element where it (or the option) isn't supported.
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { /* fall through */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') bitmap.close();
}
