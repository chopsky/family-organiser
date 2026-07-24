/**
 * Turn a raw provider/app error string into a short, readable snippet for the
 * admin UI. Provider errors are often "<status> {json}" and can be enormous -
 * Gemini's "invalid base64" error echoes the ENTIRE image payload (64KB+),
 * which must never reach the dashboard verbatim. Pull out the human message
 * when the error is JSON, then hard-cap the length.
 */
const MAX_LEN = 200;

function shortenError(raw) {
  if (raw == null) return null;
  let s = String(raw);

  // "400 {json}" or "{json}" - lift the message field out of the JSON body.
  const jsonStart = s.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const obj = JSON.parse(s.slice(jsonStart));
      const msg =
        obj?.error?.message ||
        obj?.message ||
        obj?.error?.error?.message; // nested {error:{error:{message}}}
      if (msg) {
        const prefix = s.slice(0, jsonStart).trim(); // e.g. the "400"
        s = (prefix ? `${prefix} ` : '') + msg;
      }
    } catch {
      /* not clean JSON (e.g. truncated) - fall through to plain truncation */
    }
  }

  s = s.replace(/\s+/g, ' ').trim();
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN)}…` : s;
}

module.exports = { shortenError };
