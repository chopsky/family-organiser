/**
 * Email content extraction for inbound receipt forwarding.
 * Handles Postmark inbound webhook payloads - extracts text, images, and
 * document attachments (PDF + Word .docx) via the shared document-extract
 * service, so a forwarded school .docx is parsed exactly like one sent to
 * the WhatsApp bot.
 */

const { extractTextFromDocument, isSupportedDocument } = require('./document-extract');

const MAX_TEXT_LENGTH = 8000;

/**
 * Strip the low-value chrome that rides along with forwarded / replied
 * email so the AI extractor sees the actual content, not boilerplate.
 *
 * IMPORTANT design choice: this is a CONSERVATIVE, tail-only cleaner. The
 * whole product is "forward an email and we read it," so the forwarded
 * payload - including any quoted history below a forwarding banner - is the
 * thing we MUST keep. We therefore never cut a forwarded/quoted block. We
 * only remove trailing noise that is reliably *not* content:
 *   - email signatures (the standard "\n-- \n" delimiter)
 *   - "Sent from my iPhone / Android / Samsung" client taglines
 *   - confidentiality / legal disclaimer blocks
 *   - marketing "you received this email because… / unsubscribe" footers
 *   - decorative forwarding-banner rule lines (the long dashes), while
 *     keeping the From/Subject/Date header fields they wrap
 *   - inline-image placeholders and tracking-pixel remnants
 * plus whitespace normalisation. Anything we're unsure about, we keep -
 * a false negative (a bit of noise survives) is far cheaper here than a
 * false positive (we delete the school date the user forwarded).
 *
 * @param {string} input
 * @returns {string}
 */
function stripQuotedAndForwardedNoise(input) {
  if (!input) return '';
  let text = String(input);

  // Drop inline-image placeholders Gmail/Outlook leave in the text part,
  // e.g. "[image: logo.png]" or "[cid:image001.png@01D...]".
  text = text.replace(/\[(?:image|cid)[^\]]*\]/gi, ' ');

  // Collapse the decorative rule lines of a forwarding banner but keep the
  // header fields. "---------- Forwarded message ----------" -> removed;
  // the "From: / Sent: / To: / Subject:" lines underneath survive because
  // they give the AI useful sender/date context.
  text = text.replace(/^[ \t]*-{3,}[ \t]*forwarded message[ \t]*-{3,}[ \t]*$/gim, '');
  text = text.replace(/^[ \t]*-{3,}[ \t]*original message[ \t]*-{3,}[ \t]*$/gim, '');

  const lines = text.split('\n');
  const kept = [];
  // Match the standard signature delimiter line: exactly "--" or "-- "
  // (RFC 3676 §4.3). Everything after the LAST such line is the signature.
  const SIG_DELIM = /^--\s?$/;
  // Trailing client taglines.
  const SENT_FROM = /^sent (?:from|via) (?:my )?(?:iphone|ipad|android|samsung|galaxy|blackberry|mobile|smartphone|outlook|gmail|mail|huawei|the\b).*/i;
  // First line of a confidentiality / legal-disclaimer block. Once we see
  // it, everything below is boilerplate.
  const DISCLAIMER = /(this (?:e-?mail|message|communication)[^.]{0,80}(?:confidential|intended (?:solely|only) for|privileged|may contain)|the (?:information|contents) (?:in|of) this (?:e-?mail|message)|disclaimer:|please consider the environment before printing)/i;
  // First line of a list-marketing footer. Everything below is boilerplate.
  const MARKETING = /(you (?:are )?receiv(?:ed|ing) this (?:e-?mail|message|because)|unsubscribe|manage (?:your )?(?:email )?preferences|update your preferences|view (?:this|it) in (?:your )?browser|©\s?\d{4}|all rights reserved|to stop receiving)/i;

  let cutFrom = lines.length;
  let lastSigDelim = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (SIG_DELIM.test(line)) lastSigDelim = i;
    if (
      (DISCLAIMER.test(line) || MARKETING.test(line) || SENT_FROM.test(line)) &&
      i < cutFrom
    ) {
      cutFrom = i;
    }
  }
  // Prefer the earliest cut point, but only treat the signature delimiter
  // as a cut if there's substantial content above it (guards against a
  // top-posted "-- " typo nuking the whole body).
  if (lastSigDelim > -1 && lastSigDelim < cutFrom) {
    const above = lines.slice(0, lastSigDelim).join('\n').trim();
    if (above.length >= 40) cutFrom = lastSigDelim;
  }

  let out = lines.slice(0, cutFrom).join('\n');

  // Whitespace tidy: trim trailing spaces per line, collapse 3+ blank
  // lines to a single blank line, trim ends.
  out = out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Never return less than we'd lose by giving up: if the cleaner somehow
  // ate almost everything (e.g. an unusual layout where a disclaimer line
  // appeared near the top), fall back to the lightly-normalised original
  // so we don't starve the extractor.
  if (out.length < 20 && input.trim().length > out.length) {
    return String(input).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return out;
}

/**
 * Strip HTML tags but preserve table structure so receipt line items aren't lost.
 * Extracts <td> cell contents separated by tabs, rows separated by newlines.
 */
function htmlToText(html) {
  if (!html) return '';

  let text = html;

  // Replace <br> variants with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Replace </tr> with newline to separate rows
  text = text.replace(/<\/tr>/gi, '\n');

  // Replace </td> and </th> with tab to preserve column structure
  text = text.replace(/<\/t[dh]>/gi, '\t');

  // Replace </p>, </div>, </li> with newlines
  text = text.replace(/<\/(p|div|li|h[1-6])>/gi, '\n');

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&pound;/g, '£')
    .replace(/&#163;/g, '£');

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  // Collapse multiple spaces/tabs but keep single tabs for table alignment
  text = text.replace(/ {2,}/g, ' ');

  return text.trim();
}

/**
 * Extract content from a Postmark inbound email payload.
 *
 * @param {object} postmarkPayload - The full JSON body from Postmark inbound webhook
 * @returns {{ text: string, images: Array<{data: Buffer, mediaType: string}>, subject: string, from: string }}
 */
function extractEmailContent(postmarkPayload) {
  const subject = postmarkPayload.Subject || '';
  const from = postmarkPayload.FromFull?.Email || postmarkPayload.From || '';

  let text = '';
  const images = [];

  // Prefer HTML for table structure (receipts are often HTML tables), fall back to plain text
  if (postmarkPayload.HtmlBody) {
    text = htmlToText(postmarkPayload.HtmlBody);
  } else if (postmarkPayload.TextBody) {
    text = postmarkPayload.TextBody;
  }

  // Process attachments
  const attachments = postmarkPayload.Attachments || [];
  for (const att of attachments) {
    const contentType = (att.ContentType || '').toLowerCase();
    const content = att.Content; // base64-encoded

    if (!content) continue;

    if (contentType.startsWith('image/')) {
      images.push({
        data: Buffer.from(content, 'base64'),
        mediaType: contentType,
      });
    }
    // PDFs are handled separately via extractPdfText below
  }

  // Strip signatures / disclaimers / marketing footers BEFORE truncating,
  // so a long footer can't push the real content past the length cap.
  text = stripQuotedAndForwardedNoise(text);

  // Truncate text to keep within AI context limits
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }

  return { text, images, subject, from };
}

/**
 * Extract text from document attachments (PDF + Word .docx + plain text)
 * in a Postmark payload. Image attachments are handled separately by the
 * receipt/image path; anything else is skipped.
 *
 * @param {object} postmarkPayload - The full JSON body from Postmark inbound webhook
 * @returns {Promise<string>} Extracted text from all document attachments combined
 */
async function extractAttachmentText(postmarkPayload) {
  const attachments = postmarkPayload.Attachments || [];
  const texts = [];

  for (const att of attachments) {
    const contentType = (att.ContentType || '').toLowerCase();
    if (!isSupportedDocument(contentType)) continue; // skip images & unknown types

    const content = att.Content;
    if (!content) continue;

    try {
      const buffer = Buffer.from(content, 'base64');
      const { text } = await extractTextFromDocument(buffer, contentType);
      if (text?.trim()) texts.push(text.trim());
    } catch (err) {
      // Best-effort: a single unreadable/empty/legacy-.doc attachment
      // shouldn't block extraction of the rest. document-extract throws a
      // user-facing message for those; we just log and move on here.
      console.warn(`[email-parser] Failed to parse ${contentType} attachment:`, err.message);
    }
  }

  const combined = texts.join('\n\n---\n\n');
  if (combined.length > MAX_TEXT_LENGTH) {
    return combined.slice(0, MAX_TEXT_LENGTH) + '\n\n[... truncated]';
  }
  return combined;
}

module.exports = {
  extractEmailContent,
  extractAttachmentText,
  // Back-compat alias: this used to be PDF-only. Now it also reads .docx.
  extractPdfText: extractAttachmentText,
  htmlToText,
  stripQuotedAndForwardedNoise,
};
