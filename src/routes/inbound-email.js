const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { scanReceipt, extractReceiptFromEmail } = require('../services/ai');
const { extractEmailContent, extractPdfText } = require('../services/email-parser');
const { detectAisle } = require('../utils/aisle-detect');

const router = Router();

// Rate limit: 30 per minute per IP
const inboundLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

/**
 * Parse the inbound email token from the To address.
 * Expected format: receipts-{token}@inbound.housemait.com
 */
function parseTokenFromAddress(toAddress) {
  if (!toAddress) return null;
  // Handle Postmark's full address format: "Name <email>" or just "email"
  const emailMatch = toAddress.match(/<([^>]+)>/) || [null, toAddress];
  const email = (emailMatch[1] || '').toLowerCase().trim();
  const match = email.match(/^receipts-([a-f0-9]+)@/);
  return match ? match[1] : null;
}

/**
 * POST /api/inbound-email/receipt
 * Postmark inbound webhook handler.
 * No auth middleware — this is a webhook.
 * Always returns 200 to avoid Postmark retries.
 */
router.post('/receipt', inboundLimiter, async (req, res) => {
  // Always return 200 immediately — don't leak info about valid/invalid tokens
  res.status(200).json({ ok: true });

  // Process in background (fire-and-forget)
  (async () => {
    let logId = null;
    let householdId = null;

    try {
      // Extract token from To address
      // Postmark sends To as a string or the ToFull array
      const toAddress = req.body.ToFull?.[0]?.Email || req.body.To || '';
      const token = parseTokenFromAddress(toAddress);

      if (!token) {
        console.warn('[inbound-email] No valid token found in To:', toAddress);
        return;
      }

      // Look up household
      const household = await db.getHouseholdByInboundToken(token);
      if (!household) {
        console.warn('[inbound-email] No household found for token:', token);
        return;
      }
      householdId = household.id;

      // Extract email metadata
      const { text, images, subject, from } = extractEmailContent(req.body);

      // Check for duplicate (same subject + sender within 1 hour)
      const isDuplicate = await db.checkDuplicateEmail(householdId, from, subject, 60);
      if (isDuplicate) {
        console.log('[inbound-email] Duplicate email detected, skipping:', subject);
        return;
      }

      // Create log entry
      const log = await db.createInboundEmailLog(householdId, from, subject);
      logId = log.id;

      await db.updateInboundEmailLog(logId, { status: 'processing' });

      // Extract PDF text if any
      const pdfText = await extractPdfText(req.body);

      // Collect all extraction results
      const allItems = [];

      // 1. If images found, use existing scanReceipt for each
      for (const img of images) {
        try {
          const result = await scanReceipt(img.data, img.mediaType, { householdId });
          if (result?.items?.length) {
            allItems.push(...result.items);
          }
        } catch (err) {
          console.warn('[inbound-email] Image scan failed:', err.message);
        }
      }

      // 2. If text content found (email body or PDF), use extractReceiptFromEmail
      const combinedText = [text, pdfText].filter(Boolean).join('\n\n---\n\n');
      if (combinedText.trim()) {
        try {
          const result = await extractReceiptFromEmail(combinedText, subject, { householdId });
          if (result?.items?.length) {
            allItems.push(...result.items);
          }
        } catch (err) {
          console.warn('[inbound-email] Text extraction failed:', err.message);
        }
      }

      if (!allItems.length) {
        await db.updateInboundEmailLog(logId, {
          status: 'completed',
          items_extracted: 0,
          items_added: 0,
        });
        console.log('[inbound-email] No items extracted from email:', subject);
        return;
      }

      // Deduplicate by normalised_name (case-insensitive)
      const seen = new Set();
      const uniqueItems = [];
      for (const item of allItems) {
        const key = (item.normalised_name || '').toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          uniqueItems.push(item);
        }
      }

      // Enrich with aisle categories
      const defaultList = await db.getDefaultShoppingList(householdId);
      const enrichedItems = uniqueItems.map((item) => ({
        item: item.normalised_name,
        category: detectAisle(item.normalised_name) || 'Other',
        quantity: item.quantity ? String(item.quantity) : null,
        list_id: defaultList.id,
        aisle_category: detectAisle(item.normalised_name) || 'Other',
        source: 'email',
      }));

      // Add items to shopping list
      await db.addShoppingItems(householdId, enrichedItems, null);

      // Update log
      await db.updateInboundEmailLog(logId, {
        status: 'completed',
        items_extracted: uniqueItems.length,
        items_added: enrichedItems.length,
      });

      console.log(`[inbound-email] Added ${enrichedItems.length} items from email "${subject}" for household ${householdId}`);
    } catch (err) {
      console.error('[inbound-email] Processing error:', err);
      if (logId) {
        try {
          await db.updateInboundEmailLog(logId, {
            status: 'failed',
            error_message: err.message?.slice(0, 500),
          });
        } catch (updateErr) {
          console.error('[inbound-email] Failed to update log:', updateErr);
        }
      }
    }
  })();
});

module.exports = router;
