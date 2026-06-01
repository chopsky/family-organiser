/**
 * Extract plain text from a document attachment buffer.
 *
 * Built for the WhatsApp document path: a parent forwards a school
 * letter / fixture sheet as a .docx or .pdf and expects Housemait to
 * pull the dates out. Before this, the bot replied "I can't open
 * document attachments directly" - the exact gap that lost a trialling
 * customer (the U11 cricket .docx in the 2026-06-01 transcript).
 *
 * Supported:
 *   - PDF (application/pdf)               -> pdf-parse
 *   - DOCX (...wordprocessingml.document) -> mammoth
 *   - Plain text (text/plain, text/*)     -> utf-8 decode
 *
 * Legacy .doc (application/msword, the pre-2007 binary format) is NOT
 * supported - mammoth only reads the modern XML .docx. We surface a
 * clear "save as .docx or PDF" message rather than failing opaquely.
 *
 * Returns { text, kind }. Throws an Error with a user-safe `.message`
 * for unsupported types or empty extractions so the caller can relay
 * a helpful reply.
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isPdf(mime) { return /application\/pdf/i.test(mime || ''); }
function isDocx(mime) { return (mime || '').toLowerCase() === DOCX_MIME; }
function isLegacyDoc(mime) { return (mime || '').toLowerCase() === 'application/msword'; }
function isPlainText(mime) { return /^text\//i.test(mime || ''); }

/**
 * @param {Buffer} buffer    - the raw document bytes
 * @param {string} mediaType - the MIME type (Twilio MediaContentType0)
 * @returns {Promise<{text: string, kind: 'pdf'|'docx'|'text'}>}
 */
async function extractTextFromDocument(buffer, mediaType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('The document came through empty. Please try sending it again.');
  }

  let text = '';
  let kind;

  if (isPdf(mediaType)) {
    kind = 'pdf';
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    text = data?.text || '';
  } else if (isDocx(mediaType)) {
    kind = 'docx';
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result?.value || '';
  } else if (isPlainText(mediaType)) {
    kind = 'text';
    text = buffer.toString('utf8');
  } else if (isLegacyDoc(mediaType)) {
    throw new Error("I can read PDFs and Word .docx files, but this is the older .doc format. Open it and 'Save As' a .docx or PDF, then send it again.");
  } else {
    throw new Error("I can read PDFs and Word .docx files. This file type isn't supported - try sending a PDF, a .docx, or just paste the text.");
  }

  // Emptiness check strips ALL whitespace, but we return the original
  // (whitespace-preserving) text so line/section structure survives for
  // the extractor - a fixture sheet's layout carries meaning.
  const clean = (text || '').trim();
  if (!clean.replace(/\s/g, '')) {
    throw new Error("I opened the document but couldn't find any readable text in it (it may be a scanned image). Try sending it as a photo instead, or paste the text.");
  }
  // Guard against pathological inputs - the extraction feeds an LLM
  // prompt, so cap the size. 20k chars is comfortably more than any
  // school letter and keeps the prompt within budget.
  const capped = clean.length > 20000 ? clean.slice(0, 20000) : clean;
  return { text: capped, kind };
}

/**
 * Cheap MIME sniff used by the webhook to decide whether an attachment
 * should go down the document path at all (vs image / audio).
 */
function isSupportedDocument(mediaType) {
  return isPdf(mediaType) || isDocx(mediaType) || isLegacyDoc(mediaType) || isPlainText(mediaType)
    || /application\/(msword|vnd\.openxmlformats)/i.test(mediaType || '');
}

module.exports = { extractTextFromDocument, isSupportedDocument };
