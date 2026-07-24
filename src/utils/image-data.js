/**
 * Normalise a client-supplied base64 image for the vision APIs.
 *
 * Clients (notably the iOS app, via FileReader/readAsDataURL) sometimes send
 * an image as a full data URI - "data:image/jpeg;base64,/9j/4AA...". The
 * Anthropic and Gemini vision endpoints want RAW base64: the leading
 * "data:<type>;base64," is NOT valid base64 (the ':' and ';' break the
 * decoder), so both reject it with a 400 ("invalid base64 data") in ~300ms.
 * This silently broke every iOS photo recipe import (confirmed in ai_usage_log).
 *
 * Strip the prefix so every image endpoint tolerates either shape, and lift
 * the media type out of the URI (it describes the actual bytes) when present,
 * falling back to the caller's declared type.
 *
 * Raw-base64 callers (the web app, downloaded WhatsApp media) have no prefix
 * to strip, so they pass through untouched.
 */

// data:[<mediatype>][;param=value]*;base64,  — mediatype + optional params.
const DATA_URI_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?(?:;[a-z0-9.+=-]+)*;base64,/i;

/**
 * @param {string} imageData - raw base64 OR a full data URI
 * @param {string} [fallbackMediaType='image/jpeg'] - used when no type is in the URI
 * @returns {{ data: string, mediaType: string }}
 */
function normaliseImageData(imageData, fallbackMediaType = 'image/jpeg') {
  if (typeof imageData !== 'string') {
    return { data: imageData, mediaType: fallbackMediaType };
  }
  const trimmed = imageData.trim();
  const m = trimmed.match(DATA_URI_RE);
  if (!m) {
    return { data: trimmed, mediaType: fallbackMediaType };
  }
  return {
    data: trimmed.slice(m[0].length).trim(),
    mediaType: m[1] || fallbackMediaType,
  };
}

module.exports = { normaliseImageData };
