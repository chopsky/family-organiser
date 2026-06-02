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
};
