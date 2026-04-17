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

    // Extract the phone number (strip "whatsapp:" prefix)
    const phone = From.replace(/^whatsapp:/, '').trim();

    // Look up user by WhatsApp phone
    const user = await db.getUserByWhatsAppPhone(phone);

    if (!user) {
      // Unknown user — send a helpful response
      await whatsapp.sendMessage(phone,
        `👋 Hi${ProfileName ? ` ${ProfileName}` : ''}! Welcome to Housemait.\n\n` +
        `I don't have your number linked yet. To get started:\n` +
        `1. Sign up at the Housemait web app\n` +
        `2. Go to Settings → Connect WhatsApp\n` +
        `3. Enter your phone number and verify it\n\n` +
        `Once linked, just message me naturally to manage your shopping list and tasks!`
      );
      return;
    }

    // Load household context
    const members = await db.getHouseholdMembers(user.household_id);
    const household = { id: user.household_id, members };

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
          const result = await handlers.handleVoiceNote(audioBuffer, 'voice.ogg', user, household);
          await whatsapp.sendMessage(phone, result.response);
          // Persist the transcribed text (if any) as the body so voice-note
          // turns can be replayed as conversation context too.
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'voice', intent: null, processingMs: Date.now() - start, body: result.transcription || null, response: result.response });

          // Broadcast to other members
          const notification = handlers.buildBroadcastMessage(user.name, result.actions);
          if (notification) broadcast.toHousehold(user.id, members, notification);
        } catch (err) {
          console.error('[whatsapp] Voice note error:', err.message);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'voice', processingMs: Date.now() - start, body: '[voice]', error: err.message });
          await whatsapp.sendMessage(phone, '❌ Sorry, I had trouble processing that voice note. Please try again.');
        }
        return;
      }

      if (mediaType.startsWith('image/')) {
        // Photo (receipt scanning)
        const start = Date.now();
        try {
          const imageBuffer = await whatsapp.downloadMedia(mediaUrl);
          const result = await handlers.handlePhoto(imageBuffer, mediaType, user, household);
          await whatsapp.sendMessage(phone, result.response);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'image', intent: null, processingMs: Date.now() - start, body: '[photo]', response: result.response });

          // Broadcast to other members
          const notification = handlers.buildBroadcastMessage(user.name, result.actions);
          if (notification) broadcast.toHousehold(user.id, members, notification);
        } catch (err) {
          console.error('[whatsapp] Photo error:', err.message);
          db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'image', processingMs: Date.now() - start, body: '[photo]', error: err.message });
          await whatsapp.sendMessage(phone, '❌ Sorry, I had trouble scanning that receipt. Please try again with a clearer photo.');
        }
        return;
      }
    }

    // Handle text messages
    if (Body && Body.trim()) {
      const text = Body.trim();
      const start = Date.now();

      try {
        const result = await handlers.handleTextMessage(text, user, household);
        await whatsapp.sendMessage(phone, result.response);
        db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'text', intent: result.intent || null, processingMs: Date.now() - start, body: text, response: result.response });

        // Broadcast to other members
        const notification = handlers.buildBroadcastMessage(user.name, result.actions);
        if (notification) broadcast.toHousehold(user.id, members, notification);
      } catch (err) {
        console.error('[whatsapp] Text handler error:', err.message, err.stack?.split('\n').slice(0, 3).join('\n'));
        db.logWhatsAppMessage({ householdId: user.household_id, userId: user.id, direction: 'inbound', messageType: 'text', processingMs: Date.now() - start, body: text, error: err.message });
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        await whatsapp.sendMessage(phone, `Sorry, I had trouble processing that (${elapsed}s). Please try again.`);
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
