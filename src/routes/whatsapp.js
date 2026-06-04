/**
 * WhatsApp webhook handler (Twilio).
 *
 * Receives incoming WhatsApp messages via Twilio webhooks,
 * processes them through the channel-agnostic handlers,
 * and sends responses back via the WhatsApp service.
 */

const { Router } = require('express');
const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const broadcast = require('../services/broadcast');
const handlers = require('../bot/handlers');
const cache = require('../services/cache');
const { isSupportedDocument } = require('../services/document-extract');

const router = Router();

/**
 * POST /whatsapp/webhook
 * Twilio sends incoming WhatsApp messages here.
 *
 * Twilio POST body includes:
 *   - From: "whatsapp:+447700900000"
 *   - Body: message text
 *   - NumMedia: number of media attachments
 *   - MediaUrl0, MediaContentType0: first media attachment
 *   - ProfileName: sender's WhatsApp display name
 */
router.post('/webhook', async (req, res) => {
  // Respond immediately with 200 to acknowledge receipt (Twilio expects this)
  res.status(200).send('');

  try {
    const { From, Body, NumMedia, ProfileName } = req.body;

    if (!From) return;

    // Entry-point log so every inbound turn shows up in Railway. Previously
    // a happy-path message produced zero logs unless the handler threw,
    // which made debugging reminder-save failures impossible without
    // instrumenting downstream code. Truncate Body to keep PII surface low.
    console.log('[whatsapp] webhook', JSON.stringify({
      from: From,
      profile: ProfileName || null,
      media: Number(NumMedia) || 0,
      body: typeof Body === 'string' ? Body.slice(0, 200) : null,
    }));

    // Extract the phone number (strip "whatsapp:" prefix)
    const phone = From.replace(/^whatsapp:/, '').trim();

    // Look up user by WhatsApp phone
    const user = await db.getUserByWhatsAppPhone(phone);

    // ── Pull-push pairing: an unlinked sender sending "CONNECT XXXXXX" (or
    // just the code on its own) is trying to link their WhatsApp to their
    // app account. We match the code in their message body against the
    // whatsapp_verification_codes table, and if it's still valid, link
    // the From phone to the owning user. See /api/auth/whatsapp-init-pairing.
    //
    // Done BEFORE the "unknown user" reply below so first-time pairers
    // don't get the "sign up first" message.
    if (!user && typeof Body === 'string' && Body.trim()) {
      // Pull a 5-10 char alphanumeric token from the message. Matches
      // both "CONNECT K3X9P2" and the bare code.
      const tokenMatch = Body.toUpperCase().match(/\b([23456789ABCDEFGHJKMNPQRSTVWXYZ]{5,10})\b/);
      const token = tokenMatch ? tokenMatch[1] : null;
      if (token) {
        try {
          const row = await db.findUnusedPairingCode(token);
          if (row) {
            // Atomic consume - guards against two webhook retries both
            // trying to link the same code. Whoever loses the race gets
            // null back and just falls through.
            const consumed = await db.consumePairingCode(row.id, phone);
            if (consumed) {
              await db.updateUser(row.user_id, {
                whatsapp_phone: phone,
                whatsapp_linked: true,
                whatsapp_linked_at: new Date().toISOString(),
              });
              const linkedUser = await db.getUserById(row.user_id).catch(() => null);
              const greetingName = linkedUser?.name ? ` ${linkedUser.name}` : '';
              const welcome = [
                `👋 Hey${greetingName} - Housemait here.`,
                '',
                `Your WhatsApp is now linked! Just message me like a friend:`,
                '',
                `  🛒 "We need milk and eggs"`,
                `  📋 "Remind me to book the dentist"`,
                `  📅 "Sofia football Saturday 10am"`,
                '',
                `I can also help with recipes, weather, school dates, receipts, and lots more. I'll show you new tricks over the next few days.`,
                '',
                `Reply /help any time. 📌 Pin this chat (swipe right on iOS, tap-and-hold on Android) so I don't get lost.`,
              ].join('\n');
              await whatsapp.sendMessage(phone, welcome).catch((e) =>
                console.error('[whatsapp-pair] welcome failed:', e.message)
              );
              if (linkedUser?.household_id) cache.invalidate(`members:${linkedUser.household_id}`);
              return;
            }
          }
        } catch (err) {
          console.error('[whatsapp-pair] consume failed:', err.message);
          // Fall through to "unknown user" reply
        }
      }
    }

    if (!user) {
      // Unknown user - send a helpful response
      await whatsapp.sendMessage(phone,
        `👋 Hi${ProfileName ? ` ${ProfileName}` : ''}! Welcome to Housemait.\n\n` +
        `I don't have your number linked yet. To get started:\n` +
        `1. Sign in to the Housemait app\n` +
        `2. Go to Settings → Notifications → Connect WhatsApp\n` +
        `3. Send me the pairing code shown on screen\n\n` +
        `Once linked, just message me naturally to manage your shopping list and tasks!`
      );
      return;
    }

    // Subscription gate for the bot. The web app's subscription middleware
    // only runs on /api/* routes - WhatsApp comes in via Twilio's webhook
    // at /whatsapp/webhook and bypasses it entirely. Re-check here so
    // expired households don't keep getting AI replies (which cost
    // Anthropic credits we aren't recouping).
    //
    // Internal accounts and any non-expired state (active, trialing,
    // even null in the unlikely case of a missing row) fall through. Only
    // subscription_status === 'expired' | 'cancelled' triggers the
    // canned reply.
    // Fetch the full household row once and reuse it: the subscription
    // check below needs is_internal + subscription_status, and the bot
    // handlers downstream need address + timezone + name + etc. for
    // weather, classifier context, and digest grouping. Previously this
    // row was discarded after the subscription check and downstream
    // code got a stub { id, members } object - which made household.
    // address undefined and broke the "fall back to household address
    // when no city was named" weather flow shipped in d99b877.
    let householdRow = null;
    try {
      householdRow = await db.getHouseholdById(user.household_id);
      const expired = householdRow
        && !householdRow.is_internal
        && (householdRow.subscription_status === 'expired'
          || householdRow.subscription_status === 'cancelled');
      if (expired) {
        await whatsapp.sendMessage(
          phone,
          "Your Housemait trial has ended. Subscribe at housemait.com to keep using me!"
        );
        db.logWhatsAppMessage({
          householdId: user.household_id,
          userId: user.id,
          direction: 'inbound',
          messageType: numMedia > 0 ? 'media' : 'text',
          intent: 'subscription_required',
          processingMs: 0,
          body: Body || '[media]',
          response: 'subscription required',
        });
        return;
      }
    } catch (err) {
      // Fail-open: a DB blip in the subscription check shouldn't silently
      // block paying customers from messaging the bot. Log and proceed.
      console.warn('[whatsapp] subscription check failed (failing open):', err.message);
    }

    // Refresh the user's 24h customer-service window. Fire-and-forget - the
    // webhook has already returned 200 above, and a DB hiccup here must not
    // block the reply. Once this write lands, broadcast.js can send free-form
    // WhatsApp messages to this user for the next 24 hours; outside that
    // window it falls back to a pre-approved Content Template.
    db.touchWhatsAppInbound(user.id);

    // Load household context. Reuse the householdRow fetched above for
    // the subscription check - the full row carries address, timezone,
    // name, country, etc. that downstream handlers (weather, classifier
    // prompts, digest grouping) all read. If the earlier fetch failed
    // (DB blip) we fall back to a stub so the bot still answers but
    // location-aware features will gracefully no-op.
    const members = await db.getHouseholdMembers(user.household_id);
    const household = householdRow
      ? { ...householdRow, members }
      : { id: user.household_id, members };

    const numMedia = parseInt(NumMedia || '0', 10);

    // Handle media attachments (voice notes, photos)
    if (numMedia > 0) {
      const mediaUrl = req.body.MediaUrl0;
      const mediaType = req.body.MediaContentType0 || '';

      if (mediaType.startsWith('audio/')) {
        // Voice note
        const start = Date.now();
        try {
          const audioBuffer = await whatsapp.downloadMedia(mediaUrl);
          // ctx is an OUT parameter populated by handleVoiceNote (via the
          // handleTextMessage call inside it) with the classifier intent,
          // so the log captures "create_event" / "task_add" / "chat" etc.
          // for voice notes too - not the perma-null it used to write.
          const ctx = {};
          const result = await handlers.handleVoiceNote(audioBuffer, 'voice.ogg', user, household, ctx);
          await whatsapp.sendMessage(phone, result.response);
          // Persist the transcribed text (if any) as the body so voice-note
          // turns can be replayed as conversation context too.
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'voice', intent: ctx.intent || null, processingMs: Date.now() - start, body: result.transcription || null, response: result.response });

          // Broadcast to other members
          const notification = handlers.buildBroadcastMessage(user.name, result.actions, household);
          if (notification) broadcast.toHousehold(user.id, members, notification);
        } catch (err) {
          console.error('[whatsapp] Voice note error:', err.message);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'voice', processingMs: Date.now() - start, body: '[voice]', error: err.message });
          await whatsapp.sendMessage(phone, '❌ Sorry, I had trouble processing that voice note. Please try again.');
        }
        return;
      }

      if (mediaType.startsWith('image/')) {
        // Photo - smart-classified (receipt / event / unknown). The text the
        // user sent with the image is their instruction, so pass it through.
        const start = Date.now();
        const caption = (req.body.Body || '').trim();
        try {
          const imageBuffer = await whatsapp.downloadMedia(mediaUrl);
          const result = await handlers.handlePhoto(imageBuffer, mediaType, user, household, caption);
          await whatsapp.sendMessage(phone, result.response);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'image', intent: null, processingMs: Date.now() - start, body: caption ? `[photo] ${caption}` : '[photo]', response: result.response });

          // Broadcast to other members
          const notification = handlers.buildBroadcastMessage(user.name, result.actions, household);
          if (notification) broadcast.toHousehold(user.id, members, notification);
        } catch (err) {
          console.error('[whatsapp] Photo error:', err.message);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'image', processingMs: Date.now() - start, body: '[photo]', error: err.message });
          await whatsapp.sendMessage(phone, '❌ Sorry, I had trouble reading that image. Please try again with a clearer photo.');
        }
        return;
      }

      if (isSupportedDocument(mediaType)) {
        // Document (.pdf / .docx / text) - extract text + pull out any
        // dates/tasks. Closes the "I can't open document attachments
        // directly" gap. Filename arrives as the message Body on Twilio
        // document messages, so we pass it through for extraction context.
        const start = Date.now();
        const filename = (Body || '').trim() || null;
        try {
          const docBuffer = await whatsapp.downloadMedia(mediaUrl);
          const ctx = {};
          const result = await handlers.handleDocument(docBuffer, mediaType, filename, user, household, ctx);
          await whatsapp.sendMessage(phone, result.response);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'document', intent: ctx.intent || null, processingMs: Date.now() - start, body: filename || '[document]', response: result.response });

          const notification = handlers.buildBroadcastMessage(user.name, result.actions, household);
          if (notification) broadcast.toHousehold(user.id, members, notification);
        } catch (err) {
          console.error('[whatsapp] Document error:', err.message);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'document', processingMs: Date.now() - start, body: filename || '[document]', error: err.message });
          await whatsapp.sendMessage(phone, "📄 Sorry, I had trouble reading that document. Try a PDF or .docx, or paste the text directly.");
        }
        return;
      }
    }

    // Handle text messages
    if (Body && Body.trim()) {
      const text = Body.trim();
      const start = Date.now();

      try {
        // ctx is an OUT parameter populated by handleTextMessage with the
        // resolved intent (either the AI classifier's result.intent or a
        // pre-classify shortcut tag like 'trivial' / 'slash_shopping' /
        // 'weather' / 'undo'). The function's RETURN value is still just
        // { response, actions }; intent surfaces through ctx so the log
        // call here can persist it without changing every return path
        // inside handleTextMessage's 30+ branches.
        const ctx = {};
        const result = await handlers.handleTextMessage(text, user, household, ctx);
        await whatsapp.sendMessage(phone, result.response);
        db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'text', intent: ctx.intent || null, processingMs: Date.now() - start, body: text, response: result.response });

        // Broadcast to other members
        const notification = handlers.buildBroadcastMessage(user.name, result.actions, household);
        if (notification) broadcast.toHousehold(user.id, members, notification);
      } catch (err) {
        // Verbose error logging - the old single-line console.error ate
        // the most useful fields (err.code / err.name / Supabase
        // .details + .hint / full stack). This block emits a structured
        // object that Railway preserves as-is, so any future 'Sorry I
        // had trouble processing that' is instantly diagnosable.
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.error('[whatsapp-text-handler-error]', {
          userId: user.id,
          householdId: user.household_id,
          elapsedMs: Date.now() - start,
          bodyPreview: text.slice(0, 80),
          errName: err.name,
          errMessage: err.message,
          errCode: err.code,          // Supabase / Postgres SQLSTATE when applicable
          errStatus: err.status,       // HTTP status from provider APIs
          errDetails: err.details,     // Supabase error details
          errHint: err.hint,           // Supabase error hint
          stack: err.stack,            // full stack, not just 3 lines
        });
        db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'text', processingMs: Date.now() - start, body: text, error: err.message });

        // A slightly more diagnostic user-facing message - picks a
        // rough category from the error shape so the user knows whether
        // to retry now or later.
        let userMsg;
        if (err.name === 'AbortError' || /timeout/i.test(err.message || '')) {
          userMsg = `Sorry, the AI took too long (${elapsed}s). Please try again in a moment.`;
        } else if (err.code && typeof err.code === 'string' && err.code.startsWith('2')) {
          // Postgres SQLSTATE 2xxxx = data exception / constraint violation
          userMsg = `Sorry, I couldn't save that (database error). Please try again or rephrase.`;
        } else if (/parse|JSON|unexpected token/i.test(err.message || '')) {
          userMsg = `Sorry, the AI replied in a format I couldn't read (${elapsed}s). Please try again.`;
        } else {
          userMsg = `Sorry, I had trouble processing that (${elapsed}s). Please try again.`;
        }
        await whatsapp.sendMessage(phone, userMsg);
      }
    }
  } catch (err) {
    console.error('[whatsapp] Webhook error:', err.message);
  }
});

/**
 * GET /whatsapp/webhook
 * Twilio doesn't require a verification challenge like Meta's API,
 * but we include a simple health check for debugging.
 */
router.get('/webhook', (req, res) => {
  res.status(200).json({ status: 'WhatsApp webhook active' });
});

module.exports = router;
