const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { scanReceipt, matchReceiptToList, extractFromEmail } = require('../services/ai');
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
      console.log('[inbound-email] Email text length:', combinedText.length, '| Subject:', subject);
      console.log('[inbound-email] First 500 chars:', combinedText.slice(0, 500));

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
          console.log('[inbound-email] AI extraction result:', JSON.stringify(emailResult, null, 2));
        } catch (err) {
          console.warn('[inbound-email] Email extraction failed:', err.message);
        }
      } else {
        console.warn('[inbound-email] No text content extracted from email');
      }

      let itemsAdded = 0;
      let itemsCheckedOff = 0;
      let eventsCreated = 0;
      let tasksCreated = 0;

      // Handle receipt/shopping items (from images or email-extracted items).
      //
      // Both code paths feeding allShoppingItems are receipt-shaped:
      //   • receiptItems → from scanReceipt() on attached photos
      //   • emailResult.shopping_items → the prompt restricts this to
      //     actual grocery/retail receipts (see prompts.js line 544)
      //
      // So we treat ALL items here as "things that were purchased",
      // which means: match against the current shopping list and
      // CHECK OFF anything that's on it. Unmatched receipt items
      // (one-off purchases not previously planned) get added as
      // already-completed so they show up in "Previously purchased"
      // without cluttering the active list.
      //
      // Previous behaviour was to blindly addShoppingItems(), which
      // re-added every item on the receipt as a new pending row even
      // when the user had already planned to buy them.
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
              uniqueItems.push({
                ...item,
                normalised_name: name,
                // Provide both shapes so matchReceiptToList (expects
                // normalised_name + original_text) is happy.
                original_text: item.original_text || item.item || name,
              });
            }
          }

          // Pull the active (not-completed) shopping list to match against.
          const shoppingList = await db.getShoppingList(householdId);
          const matchResult = await matchReceiptToList(uniqueItems, shoppingList, { householdId });
          const toCheckOff = (matchResult.matches || []).filter((m) => m.confidence >= 0.7);
          await Promise.all(toCheckOff.map((m) => db.completeShoppingItemById(m.list_item_id)));
          itemsCheckedOff = toCheckOff.length;

          // Receipt items that didn't match anything on the active list.
          // Add them as already-completed so they live in Previously
          // purchased (useful for "buy again" suggestions) without
          // appearing on the next shopping run.
          const matchedNames = new Set(
            (matchResult.matches || [])
              .filter((m) => m.confidence >= 0.7)
              .map((m) => m.receipt_item_normalised || m.list_item_name?.toLowerCase())
          );
          const unmatchedItems = uniqueItems.filter((u) => !matchedNames.has(u.normalised_name));
          if (unmatchedItems.length) {
            const defaultList = await db.getDefaultShoppingList(householdId);
            const enrichedItems = unmatchedItems.map((item) => ({
              item: item.normalised_name || item.item,
              quantity: item.quantity ? String(item.quantity) : null,
              list_id: defaultList?.id,
              aisle_category: detectAisle(item.normalised_name || item.item) || 'Other',
              source: 'email_forward',
              completed: true,
            }));
            await db.addShoppingItems(householdId, enrichedItems, null);
            itemsAdded = enrichedItems.length;
          }
        } catch (err) {
          console.warn('[inbound-email] Shopping items failed:', err.message);
        }
      }

      // Handle calendar events
      if (emailResult?.events?.length) {
        for (const ev of emailResult.events) {
          try {
            const assigneeNames = ev.assigned_to_names || (ev.assigned_to_name ? [ev.assigned_to_name] : []);
            const firstAssignee = assigneeNames.length > 0
              ? members.find(m => m.name.toLowerCase() === assigneeNames[0].toLowerCase())
              : null;

            // AI extracts local times — store without Z suffix so the app
            // interprets them in the user's timezone (same as manually created events)
            const startTime = ev.all_day
              ? `${ev.date}T00:00:00`
              : `${ev.date}T${ev.start_time || '09:00'}:00`;
            const endTime = ev.all_day
              ? `${ev.date}T23:59:59`
              : `${ev.date}T${ev.end_time || ev.start_time || '10:00'}:00`;

            const created = await db.createCalendarEvent(householdId, {
              title: ev.title,
              start_time: startTime,
              end_time: endTime,
              all_day: !!ev.all_day,
              assigned_to: firstAssignee?.id || null,
              assigned_to_name: firstAssignee?.name || assigneeNames[0] || null,
              color: firstAssignee?.color_theme || 'sage',
              location: ev.location || null,
              description: ev.description || null,
              source: 'email_forward',
            }, null);

            if (created && assigneeNames.length > 0) {
              await db.saveEventAssignees(created.id, householdId, assigneeNames, members);
            }
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

      // Update log. `items_added` keeps its semantic of "new rows
      // inserted on the shopping list" — checked-off items aren't new
      // rows, so they're reported separately in the console log but
      // don't bump items_added.
      const totalActions = itemsAdded + itemsCheckedOff + eventsCreated + tasksCreated;
      await db.updateInboundEmailLog(logId, {
        status: 'completed',
        items_extracted: totalActions,
        items_added: itemsAdded,
      });

      console.log(`[inbound-email] Processed "${subject}" for household ${householdId}: ${itemsCheckedOff} items checked off, ${itemsAdded} items added to history, ${eventsCreated} events, ${tasksCreated} tasks`);
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
