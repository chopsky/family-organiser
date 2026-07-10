/**
 * WhatsApp webhook handler (Twilio).
 *
 * Receives incoming WhatsApp messages via Twilio webhooks,
 * processes them through the channel-agnostic handlers,
 * and sends responses back via the WhatsApp service.
 */

const { Router } = require('express');
const twilio = require('twilio');
const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const broadcast = require('../services/broadcast');
const handlers = require('../bot/handlers');
const cache = require('../services/cache');
const { isSupportedDocument } = require('../services/document-extract');

const router = Router();

/**
 * Verify an inbound webhook was actually signed by Twilio. Without this,
 * anyone could POST a forged `{ From, Body }` to /whatsapp/webhook and drive
 * the bot to read, add, or delete a household's data (and burn AI credits) -
 * the handler trusts `From` to identify the sender.
 *
 * Twilio signs each request with our auth token over the exact webhook URL +
 * POST params (X-Twilio-Signature). When TWILIO_AUTH_TOKEN is set (always in
 * production) we require a valid signature. When it's unset we allow in
 * non-production (local dev / tests) but FAIL CLOSED in production so a
 * missing env var can't silently reopen the webhook to forgery.
 */
function verifyTwilioSignature(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[whatsapp] TWILIO_AUTH_TOKEN unset - rejecting webhook (fail closed)');
      return false;
    }
    return true; // dev/test convenience only
  }
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;
  // Twilio signs the full external URL it POSTed to. `trust proxy` is set
  // (app.js), so req.protocol/host reflect Railway's X-Forwarded-* headers.
  // TWILIO_WEBHOOK_URL overrides if the reconstructed URL ever drifts.
  const url = process.env.TWILIO_WEBHOOK_URL
    || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  try {
    return twilio.validateRequest(token, signature, url, req.body || {});
  } catch (err) {
    console.error('[whatsapp] Twilio signature check threw:', err.message);
    return false;
  }
}

/**
 * Message an expired/cancelled household sees when it messages the bot.
 * Beyond "your trial ended", it states the price and gives a direct link to
 * checkout so a willing buyer can subscribe in a tap - the WhatsApp channel
 * was previously the weakest paywall in the product (a single bare line).
 * The £ figures are GBP (the primary market) for display only; the /subscribe
 * page localises the real amount and handles the actual checkout + any
 * pre-applied promo.
 */
function buildExpiredUpgradeMessage(webUrl) {
  const base = (webUrl || 'https://housemait.com').replace(/\/+$/, '');
  return [
    'Your Housemait free trial has ended.',
    '',
    'Keep your shared family calendar, lists, meal planner and me (your WhatsApp assistant) for £5.99/month — or £59.99/year (2 months free).',
    '',
    `Subscribe in under a minute: ${base}/subscribe`,
  ].join('\n');
}

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
  // SECURITY: reject anything not signed by Twilio BEFORE the 200 ack or any
  // processing. Real Twilio traffic always carries a valid signature, so this
  // only blocks forged requests.
  if (!verifyTwilioSignature(req)) {
    return res.status(403).send('Invalid signature');
  }

  // Respond immediately with 200 to acknowledge receipt (Twilio expects this)
  res.status(200).send('');

  try {
    const { From, Body, NumMedia, ProfileName, MessageSid } = req.body;

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

    // Media count for this turn. Declared up here (not lower down) so the
    // expired-subscription gate below can reference it WITHOUT a temporal-
    // dead-zone ReferenceError. Previously it was a `const` declared further
    // down; the gate read it early, threw, and the gate's fail-open catch
    // swallowed the throw - so expired/cancelled households skipped the
    // paywall and fell through to a free (billable) AI reply.
    const numMedia = parseInt(NumMedia || '0', 10);

    // ── Pull-push pairing: a sender sending "CONNECT XXXXXX" (or just the
    // code on its own) is trying to link their WhatsApp to an app account.
    // We match the code against whatsapp_verification_codes and, if valid,
    // link the From phone to the owning user. See /whatsapp-init-pairing.
    //
    // Two sender states reach this:
    //   - UNKNOWN number: the original first-time pairing. Loose token
    //     match (a code-looking word anywhere in the message). Done BEFORE
    //     the "unknown user" reply so first-timers don't get "sign up first".
    //   - ALREADY-LINKED number with a valid code for a DIFFERENT account:
    //     a deliberate "move my number" (they signed up fresh / switched
    //     household). STRICT match only - the whole message must be the code
    //     (optionally prefixed CONNECT) - so ordinary chat words that happen
    //     to fit the code alphabet ("THANKS") can't divert a real message.
    //     LAST-WRITE-WINS: the number is unlinked from every other account,
    //     because the webhook routes purely by number and duplicates would
    //     blind the bot for both households.
    if (typeof Body === 'string' && Body.trim()) {
      const upper = Body.toUpperCase();
      const looseMatch = upper.match(/\b([23456789ABCDEFGHJKMNPQRSTVWXYZ]{5,10})\b/);
      const strictMatch = upper.trim().match(/^(?:CONNECT\s+)?([23456789ABCDEFGHJKMNPQRSTVWXYZ]{5,10})$/);
      const token = user ? (strictMatch ? strictMatch[1] : null) : (looseMatch ? looseMatch[1] : null);
      if (token) {
        try {
          const row = await db.findUnusedPairingCode(token);
          if (row) {
            // Atomic consume - guards against two webhook retries both
            // trying to link the same code. Whoever loses the race gets
            // null back and just falls through.
            const consumed = await db.consumePairingCode(row.id, phone);
            if (consumed) {
              const sameAccount = !!user && row.user_id === user.id;
              // Displace any other account holding this number BEFORE
              // linking, so a unique index can never be violated and the
              // lookup stays unambiguous.
              const displaced = sameAccount
                ? []
                : await db.unlinkWhatsAppNumberFromOthers(phone, row.user_id);
              await db.updateUser(row.user_id, {
                whatsapp_phone: phone,
                whatsapp_linked: true,
                whatsapp_linked_at: new Date().toISOString(),
              });
              const linkedUser = await db.getUserById(row.user_id).catch(() => null);
              if (sameAccount) {
                // Re-pairing a number that's already on this account: the
                // code is consumed (so the app's polling flips to linked)
                // and a short confirmation beats a second full welcome.
                await whatsapp.sendMessage(phone, `✅ This number is already connected to your account - you're all set.`).catch((e) =>
                  console.error('[whatsapp-pair] confirm failed:', e.message)
                );
              } else {
                const greetingName = linkedUser?.name ? ` ${linkedUser.name}` : '';
                const welcomeLines = [
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
                ];
                if (displaced.length > 0) {
                  welcomeLines.push('', `ℹ️ This number was connected to a different Housemait account before - that link has been replaced, and messages from this number now reach this household.`);
                }
                await whatsapp.sendMessage(phone, welcomeLines.join('\n')).catch((e) =>
                  console.error('[whatsapp-pair] welcome failed:', e.message)
                );
              }
              if (linkedUser?.household_id) cache.invalidate(`members:${linkedUser.household_id}`);
              for (const d of displaced) {
                if (d.household_id) cache.invalidate(`members:${d.household_id}`);
              }
              return;
            }
          }
          // Token didn't match a live pairing code: for a linked sender
          // this was just a normal message (fall through to chat); for an
          // unknown sender, fall through to the "sign up first" reply.
        } catch (err) {
          console.error('[whatsapp-pair] consume failed:', err.message);
          // Fall through to "unknown user" reply / normal handling
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
        await whatsapp.sendMessage(phone, buildExpiredUpgradeMessage(process.env.WEB_URL));
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

    // Show "typing…" while the AI works on the reply. Placed AFTER the
    // pairing/paywall gates (those reply instantly) and before the AI-bound
    // media/text branches, so the user sees life during the multi-second
    // classify/transcribe wait instead of a silent gap. Fire-and-forget -
    // sendTypingIndicator never throws, and a failed indicator must not
    // delay the reply. Lasts up to 25s or until our reply is delivered.
    whatsapp.sendTypingIndicator(MessageSid);

    // Handle media attachments (voice notes, photos). numMedia was computed
    // near the top of the handler (single source of truth, also used by the
    // expired-subscription gate above).
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

        // Category still drives WHICH message (retry-now vs retry-later),
        // but the copy is warm and non-technical — no elapsed seconds, no
        // "AI/JSON/format" internals (those live in the log block above).
        let userMsg;
        if (err.name === 'AbortError' || /timeout/i.test(err.message || '')) {
          userMsg = 'Sorry — that took me longer than it should. Give me another try in a moment 🙏';
        } else if (err.code && typeof err.code === 'string' && err.code.startsWith('2')) {
          // Postgres SQLSTATE 2xxxx = data exception / constraint violation
          userMsg = "I couldn't save that just now. Mind trying again in a minute?";
        } else if (/parse|JSON|unexpected token/i.test(err.message || '')) {
          userMsg = 'I scrambled that one — sorry! Please send it again.';
        } else {
          userMsg = 'Something went wrong on my end — try that again for me?';
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
// Exposed for unit tests - pure helper, no Express/Twilio dependency.
module.exports.buildExpiredUpgradeMessage = buildExpiredUpgradeMessage;
