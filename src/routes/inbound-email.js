const { Router } = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db/queries');
const { scanReceipt, matchReceiptToList, extractFromEmail } = require('../services/ai');
const { extractEmailContent, extractPdfText } = require('../services/email-parser');
const { detectAisle } = require('../utils/aisle-detect');
const { sendInboundEmailConfirmation } = require('../services/email');

const API_URL = process.env.API_URL || 'https://api.housemait.com';

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
      // Track every row this email created or modified so the
      // confirmation UNDO link can reverse it. checked_off holds IDs
      // of *existing* rows that got marked completed; added_items /
      // events / tasks hold IDs of rows that were freshly inserted.
      const actionsTaken = {
        checked_off: [],
        checked_off_names: [], // for the human-readable confirmation summary
        added_items: [],
        added_item_names: [],
        events: [],
        event_titles: [],
        tasks: [],
        task_titles: [],
      };

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
          for (const m of toCheckOff) {
            actionsTaken.checked_off.push(m.list_item_id);
            if (m.list_item_name) actionsTaken.checked_off_names.push(m.list_item_name);
          }

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
            const inserted = await db.addShoppingItems(householdId, enrichedItems, null);
            itemsAdded = inserted?.length || enrichedItems.length;
            for (const row of inserted || []) {
              actionsTaken.added_items.push(row.id);
              if (row.item) actionsTaken.added_item_names.push(row.item);
            }
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
            if (created?.id) {
              actionsTaken.events.push(created.id);
              if (created.title || ev.title) actionsTaken.event_titles.push(created.title || ev.title);
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
          const insertedTasks = await db.addTasks(
            householdId,
            emailResult.tasks.map(t => ({ ...t, action: 'add' })),
            null,
            members,
          );
          tasksCreated = insertedTasks?.length || emailResult.tasks.length;
          for (const t of insertedTasks || []) {
            actionsTaken.tasks.push(t.id);
            if (t.title) actionsTaken.task_titles.push(t.title);
          }
        } catch (err) {
          console.warn('[inbound-email] Task creation failed:', err.message);
        }
      }

      // Update log + persist the action IDs the undo endpoint will need.
      // `items_added` keeps its semantic of "new rows inserted on the
      // shopping list" — checked-off items aren't new rows, so they're
      // reported separately in the console log but don't bump items_added.
      const totalActions = itemsAdded + itemsCheckedOff + eventsCreated + tasksCreated;
      const undoToken = totalActions > 0 ? crypto.randomBytes(16).toString('hex') : null;
      await db.updateInboundEmailLog(logId, {
        status: 'completed',
        items_extracted: totalActions,
        items_added: itemsAdded,
        actions_taken: actionsTaken,
        undo_token: undoToken,
      });

      console.log(`[inbound-email] Processed "${subject}" for household ${householdId}: ${itemsCheckedOff} items checked off, ${itemsAdded} items added to history, ${eventsCreated} events, ${tasksCreated} tasks`);

      // Send a confirmation reply to the forwarder so they know what
      // happened + can self-revert via the UNDO link. Skipped if no
      // actions were taken (don't spam users on noise/marketing).
      if (totalActions > 0 && from) {
        try {
          const lines = [];
          if (itemsCheckedOff) {
            const names = actionsTaken.checked_off_names.slice(0, 6).join(', ');
            const extra = actionsTaken.checked_off_names.length > 6 ? `, +${actionsTaken.checked_off_names.length - 6} more` : '';
            lines.push(`✓ Ticked ${itemsCheckedOff} item${itemsCheckedOff === 1 ? '' : 's'} off your shopping list${names ? ` (${names}${extra})` : ''}.`);
          }
          if (itemsAdded) {
            const names = actionsTaken.added_item_names.slice(0, 6).join(', ');
            const extra = actionsTaken.added_item_names.length > 6 ? `, +${actionsTaken.added_item_names.length - 6} more` : '';
            lines.push(`+ Added ${itemsAdded} item${itemsAdded === 1 ? '' : 's'} to Previously purchased${names ? ` (${names}${extra})` : ''}.`);
          }
          if (eventsCreated) {
            const names = actionsTaken.event_titles.slice(0, 4).join(', ');
            lines.push(`📅 Added ${eventsCreated} event${eventsCreated === 1 ? '' : 's'} to the calendar${names ? ` (${names})` : ''}.`);
          }
          if (tasksCreated) {
            const names = actionsTaken.task_titles.slice(0, 4).join(', ');
            lines.push(`☑ Added ${tasksCreated} task${tasksCreated === 1 ? '' : 's'}${names ? ` (${names})` : ''}.`);
          }
          const undoUrl = `${API_URL}/api/inbound-email/undo/${undoToken}`;
          await sendInboundEmailConfirmation(from, lines.join('\n'), undoUrl, subject);
        } catch (err) {
          console.warn('[inbound-email] Confirmation email failed:', err.message);
        }
      }
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

/**
 * GET /api/inbound-email/undo/:token
 *
 * One-tap reverse of a recent forwarded-email processing. Token comes
 * from the confirmation email's UNDO link; it's single-use and stored
 * on the inbound_email_log row. Reverses (best-effort):
 *   • Re-uncompletes shopping items that were checked off
 *   • Deletes shopping items that were added (Previously purchased)
 *   • Deletes calendar events that were created
 *   • Deletes tasks that were created
 *
 * Returns a tiny HTML response so the user gets a confirmation page
 * when they tap the link from their inbox. No auth — the token is
 * the auth, and the link is sent only to the original forwarder.
 */
router.get('/undo/:token', async (req, res) => {
  const token = req.params.token;
  if (!token) {
    return res.status(400).send(undoHtml('Invalid link.', 'No token in URL.'));
  }
  try {
    const log = await db.getInboundEmailLogByUndoToken(token);
    if (!log) {
      return res.status(404).send(undoHtml('Link not found', 'This undo link is invalid or has already been used.'));
    }
    if (log.undone_at) {
      return res.status(409).send(undoHtml('Already undone', "We've already reverted this email — nothing more to do."));
    }

    const actions = log.actions_taken || {};
    let restored = 0;
    let deletedItems = 0;
    let deletedEvents = 0;
    let deletedTasks = 0;

    // Uncomplete shopping items that were checked off.
    for (const itemId of actions.checked_off || []) {
      try {
        await db.uncompleteShoppingItem(itemId, log.household_id);
        restored++;
      } catch (err) {
        console.warn('[inbound-email/undo] uncomplete failed for', itemId, err.message);
      }
    }
    // Delete shopping items that were added (the unmatched receipt rows).
    for (const itemId of actions.added_items || []) {
      try {
        await db.deleteShoppingItem(itemId, log.household_id);
        deletedItems++;
      } catch (err) {
        console.warn('[inbound-email/undo] delete shopping item failed for', itemId, err.message);
      }
    }
    // Delete created events.
    for (const eventId of actions.events || []) {
      try {
        await db.deleteCalendarEvent(eventId, log.household_id);
        deletedEvents++;
      } catch (err) {
        console.warn('[inbound-email/undo] delete event failed for', eventId, err.message);
      }
    }
    // Delete created tasks.
    for (const taskId of actions.tasks || []) {
      try {
        await db.deleteTask(taskId, log.household_id);
        deletedTasks++;
      } catch (err) {
        console.warn('[inbound-email/undo] delete task failed for', taskId, err.message);
      }
    }

    // Mark the log row as undone so the token can't be reused.
    await db.updateInboundEmailLog(log.id, {
      undone_at: new Date().toISOString(),
      undo_token: null, // free the unique index for future tokens
    });

    const summaryLines = [];
    if (restored) summaryLines.push(`Restored ${restored} item${restored === 1 ? '' : 's'} to your shopping list.`);
    if (deletedItems) summaryLines.push(`Removed ${deletedItems} item${deletedItems === 1 ? '' : 's'} from Previously purchased.`);
    if (deletedEvents) summaryLines.push(`Deleted ${deletedEvents} event${deletedEvents === 1 ? '' : 's'}.`);
    if (deletedTasks) summaryLines.push(`Deleted ${deletedTasks} task${deletedTasks === 1 ? '' : 's'}.`);
    const summary = summaryLines.length ? summaryLines.join('<br>') : 'Nothing to revert.';

    return res.send(undoHtml('Undone', summary));
  } catch (err) {
    console.error('[inbound-email/undo] error:', err);
    return res.status(500).send(undoHtml('Something went wrong', 'We couldn\'t complete the undo. Please try again or contact support.'));
  }
});

/**
 * Minimal HTML response for the undo confirmation page. Standalone
 * (no SPA, no script) so it loads instantly when tapped from an
 * email client, including ones that open in their own minimal browser.
 */
function undoHtml(heading, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — Housemait</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;margin:0;padding:48px 24px;background:#FBF8F3;color:#2D2A33;}
  .card{max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 16px rgba(107,63,160,0.08);}
  h1{font-family:'Instrument Serif',Georgia,serif;font-size:32px;font-weight:400;margin:0 0 16px;color:#6B3FA0;}
  p{line-height:1.6;font-size:16px;color:#2D2A33;margin:0;}
</style></head>
<body><div class="card"><h1>${heading}</h1><p>${body}</p></div></body></html>`;
}

module.exports = router;
