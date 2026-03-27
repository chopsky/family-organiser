const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { scanReceipt, extractFromEmail } = require('../services/ai');
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
 * Expected format: {token}@inbound.housemait.com
 */
function parseTokenFromAddress(toAddress) {
  if (!toAddress) return null;
  const emailMatch = toAddress.match(/<([^>]+)>/) || [null, toAddress];
  const email = (emailMatch[1] || '').toLowerCase().trim();
  const match = email.match(/^([a-f0-9]+)@/);
  return match ? match[1] : null;
}

/**
 * Helper: convert local date+time to UTC ISO string
 */
function localToUTC(dateStr, timeStr, tz) {
  try {
    const dt = new Date(`${dateStr}T${timeStr}:00`);
    // Use Intl to get offset for the timezone
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = formatter.formatToParts(dt);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    // Simple fallback: assume UK timezone
    return dt.toISOString();
  } catch {
    return `${dateStr}T${timeStr}:00Z`;
  }
}

/**
 * POST /api/inbound-email/webhook
 * Postmark inbound webhook handler.
 * No auth middleware — this is a webhook.
 * Always returns 200 to avoid Postmark retries.
 */
router.post('/webhook', inboundLimiter, async (req, res) => {
  // Always return 200 immediately — don't leak info about valid/invalid tokens
  res.status(200).json({ ok: true });

  // Process in background (fire-and-forget)
  (async () => {
    let logId = null;
    let householdId = null;

    try {
      // Extract token from To address
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

      // Get household members for assignment
      const members = await db.getHouseholdMembers(householdId);
      const memberNames = members.map(m => m.name);

      // Extract PDF text if any
      const pdfText = await extractPdfText(req.body);

      // Combine all text content
      const combinedText = [text, pdfText].filter(Boolean).join('\n\n---\n\n');

      // Process image attachments (receipt photos)
      const receiptItems = [];
      for (const img of images) {
        try {
          const result = await scanReceipt(img.data, img.mediaType, { householdId });
          if (result?.items?.length) {
            receiptItems.push(...result.items);
          }
        } catch (err) {
          console.warn('[inbound-email] Image scan failed:', err.message);
        }
      }

      // Use AI to classify and extract from the email text
      let emailResult = null;
      if (combinedText.trim()) {
        try {
          emailResult = await extractFromEmail(combinedText, subject, memberNames, { householdId });
        } catch (err) {
          console.warn('[inbound-email] Email extraction failed:', err.message);
        }
      }

      let itemsAdded = 0;
      let eventsCreated = 0;
      let tasksCreated = 0;

      // Handle receipt/shopping items (from images or email-extracted items)
      const allShoppingItems = [...receiptItems];
      if (emailResult?.shopping_items?.length) {
        allShoppingItems.push(...emailResult.shopping_items);
      }

      if (allShoppingItems.length) {
        try {
          const seen = new Set();
          const uniqueItems = [];
          for (const item of allShoppingItems) {
            const name = (item.normalised_name || item.item || '').toLowerCase().trim();
            if (name && !seen.has(name)) {
              seen.add(name);
              uniqueItems.push({ ...item, normalised_name: name });
            }
          }

          const defaultList = await db.getDefaultShoppingList(householdId);
          const enrichedItems = uniqueItems.map((item) => ({
            item: item.normalised_name || item.item,
            quantity: item.quantity ? String(item.quantity) : null,
            list_id: defaultList?.id,
            aisle_category: detectAisle(item.normalised_name || item.item) || 'Other',
            source: 'email_forward',
          }));

          await db.addShoppingItems(householdId, enrichedItems, null);
          itemsAdded = enrichedItems.length;
        } catch (err) {
          console.warn('[inbound-email] Shopping items failed:', err.message);
        }
      }

      // Handle calendar events
      if (emailResult?.events?.length) {
        for (const ev of emailResult.events) {
          try {
            const assignee = ev.assigned_to_name
              ? members.find(m => m.name.toLowerCase() === ev.assigned_to_name.toLowerCase())
              : null;

            const startTime = ev.all_day
              ? `${ev.date}T00:00:00Z`
              : `${ev.date}T${ev.start_time || '09:00'}:00Z`;
            const endTime = ev.all_day
              ? `${ev.date}T23:59:59Z`
              : `${ev.date}T${ev.end_time || ev.start_time || '10:00'}:00Z`;

            await db.createCalendarEvent(householdId, {
              title: ev.title,
              start_time: startTime,
              end_time: endTime,
              all_day: !!ev.all_day,
              assigned_to: assignee?.id || null,
              assigned_to_name: assignee?.name || ev.assigned_to_name || null,
              color: assignee?.color_theme || 'lavender',
              location: ev.location || null,
              description: ev.description || null,
              source: 'email_forward',
            }, null);
            eventsCreated++;
          } catch (err) {
            console.warn('[inbound-email] Event creation failed:', err.message);
          }
        }
      }

      // Handle tasks
      if (emailResult?.tasks?.length) {
        try {
          await db.addTasks(householdId, emailResult.tasks.map(t => ({
            ...t,
            action: 'add',
          })), null, members);
          tasksCreated = emailResult.tasks.length;
        } catch (err) {
          console.warn('[inbound-email] Task creation failed:', err.message);
        }
      }

      // Update log
      const totalActions = itemsAdded + eventsCreated + tasksCreated;
      await db.updateInboundEmailLog(logId, {
        status: 'completed',
        items_extracted: totalActions,
        items_added: itemsAdded,
      });

      console.log(`[inbound-email] Processed "${subject}" for household ${householdId}: ${itemsAdded} shopping items, ${eventsCreated} events, ${tasksCreated} tasks`);
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
