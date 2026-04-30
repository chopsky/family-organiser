/**
 * File-upload validation for the Documents feature.
 *
 * Two layers of protection on every upload:
 *   1. Extension allowlist  — reject if the file extension isn't in our
 *      narrow set of known-safe document/image/office types.
 *   2. Magic-byte sniff     — reject if the actual file bytes don't match
 *      what the extension claims. Stops "rename evil.exe to evil.pdf"
 *      attacks, and stops MIME spoofing where a malicious client lies in
 *      the Content-Type header.
 *
 * We deliberately don't use the `file-type` npm package — its ESM-only
 * post-v17 versions don't import cleanly into CJS, and our allowlist is
 * small enough that hand-rolled magic-byte checks are simpler and have
 * zero supply-chain surface. ~80 lines, easy to audit.
 *
 * What we DON'T validate here (out of scope for P0):
 *   - Virus / malware scanning. The whitelist below blocks executables
 *     and scripts entirely, which removes the dominant infection vector.
 *     ClamAV / VirusTotal would be a P2 follow-up if real abuse appears.
 *   - PDF / Office macro inspection. Modern browsers and Office sandbox
 *     macros aggressively; we don't try to outsmart them.
 *   - Per-household quotas, size caps — handled by the route already.
 */

// Extension → metadata. `magic` is a list of byte-prefix patterns that
// each match. Each pattern is an array of (offset, [bytes…]) tuples. ALL
// tuples in a pattern must match for that pattern to count, but ANY of
// the patterns satisfies the magic check (covers e.g. JPEG variants).
//
// `mime` is the canonical Content-Type we'll store in the DB and serve
// back, regardless of what the client claimed in its upload request —
// don't trust client MIME ever.
const ALLOWED = {
  // Documents
  pdf:  { mime: 'application/pdf', magic: [[[0, [0x25, 0x50, 0x44, 0x46, 0x2D]]]] }, // %PDF-
  txt:  { mime: 'text/plain',      magic: null }, // text has no magic; sniff differently below
  csv:  { mime: 'text/csv',        magic: null },

  // Images
  png:  { mime: 'image/png',  magic: [[[0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]]]] },
  jpg:  { mime: 'image/jpeg', magic: [[[0, [0xFF, 0xD8, 0xFF]]]] },
  jpeg: { mime: 'image/jpeg', magic: [[[0, [0xFF, 0xD8, 0xFF]]]] },
  gif:  { mime: 'image/gif',  magic: [[[0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]]], [[0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]]]] }, // GIF87a / GIF89a
  webp: { mime: 'image/webp', magic: [[[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]]] }, // RIFF…WEBP
  heic: { mime: 'image/heic', magic: [[[4, [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]]], [[4, [0x66, 0x74, 0x79, 0x70, 0x6D, 0x69, 0x66, 0x31]]], [[4, [0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x78]]]] }, // ftypheic / ftypmif1 / ftypheix

  // Microsoft Office (modern OOXML — actually ZIP archives)
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  magic: [[[0, [0x50, 0x4B, 0x03, 0x04]]]] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        magic: [[[0, [0x50, 0x4B, 0x03, 0x04]]]] },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: [[[0, [0x50, 0x4B, 0x03, 0x04]]]] },

  // Microsoft Office (legacy OLE compound binary)
  doc:  { mime: 'application/msword',                    magic: [[[0, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]]]] },
  xls:  { mime: 'application/vnd.ms-excel',              magic: [[[0, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]]]] },
  ppt:  { mime: 'application/vnd.ms-powerpoint',         magic: [[[0, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]]]] },
};

// Comma-joined list for `accept=` on the frontend file input.
const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED).map((ext) => `.${ext}`).join(',');

/**
 * Match a buffer prefix against a magic-byte pattern set.
 * Returns true if any pattern (an AND-list of (offset, bytes) tuples)
 * fully matches the buffer.
 */
function matchesAnyPattern(buffer, patterns) {
  for (const pattern of patterns) {
    let allMatched = true;
    for (const [offset, bytes] of pattern) {
      for (let i = 0; i < bytes.length; i++) {
        if (buffer[offset + i] !== bytes[i]) {
          allMatched = false;
          break;
        }
      }
      if (!allMatched) break;
    }
    if (allMatched) return true;
  }
  return false;
}

/**
 * Sniff a text-ish buffer: return true if it contains only printable
 * UTF-8 / ASCII bytes (plus common whitespace). Used for .txt and .csv
 * which have no fixed magic. We're not trying to be perfect — just
 * stopping someone uploading evil.exe renamed to evil.txt.
 */
function looksLikePlainText(buffer) {
  const sample = buffer.slice(0, Math.min(buffer.length, 8192));
  for (const byte of sample) {
    // Allow tab, LF, CR, and printable ASCII / UTF-8 continuation bytes.
    // Reject NULs and control chars below 0x09 — characteristic of binaries.
    if (byte === 0x00) return false;
    if (byte < 0x09) return false;
    if (byte > 0x0D && byte < 0x20) return false;
  }
  return true;
}

/**
 * Validate an uploaded file. Returns the canonical extension and MIME
 * to store. Throws an Error with `.statusCode = 415` on rejection.
 *
 * @param {Buffer} buffer            - file bytes (from multer.memoryStorage)
 * @param {string} originalFilename  - e.g. "Passport scan.PDF"
 * @returns {{ ext: string, mime: string }}
 */
function validateUpload(buffer, originalFilename) {
  const filename = (originalFilename || '').trim();
  const dotIdx = filename.lastIndexOf('.');
  const ext = dotIdx >= 0 ? filename.slice(dotIdx + 1).toLowerCase() : '';

  if (!ext || !(ext in ALLOWED)) {
    const err = new Error(
      `File type ".${ext || '(no extension)'}" is not allowed. ` +
      `Supported: ${Object.keys(ALLOWED).join(', ')}.`
    );
    err.statusCode = 415;
    throw err;
  }

  const spec = ALLOWED[ext];

  // Magic-byte check (binary types)
  if (spec.magic) {
    if (!matchesAnyPattern(buffer, spec.magic)) {
      const err = new Error(
        `File contents do not match a valid .${ext} file. ` +
        `If this file is genuinely a .${ext}, it may be corrupted.`
      );
      err.statusCode = 415;
      throw err;
    }
  } else {
    // Text-ish types — heuristic sniff
    if (!looksLikePlainText(buffer)) {
      const err = new Error(
        `File contents do not appear to be plain text. ` +
        `Binary files cannot be uploaded as .${ext}.`
      );
      err.statusCode = 415;
      throw err;
    }
  }

  return { ext, mime: spec.mime };
}

module.exports = { validateUpload, ACCEPT_ATTRIBUTE, ALLOWED };
