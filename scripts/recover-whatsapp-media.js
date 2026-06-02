#!/usr/bin/env node
/**
 * recover-whatsapp-media.js - pull a user's inbound WhatsApp media back
 * out of Twilio's retention, for when Housemait didn't persist it.
 *
 * Housemait downloads inbound media to a transient Buffer and discards
 * it - nothing is stored our side. But Twilio retains inbound media on
 * its CDN, reachable via the Messages API. This script finds a member's
 * inbound messages around a date and downloads any media attachments.
 *
 * Usage:
 *   node scripts/recover-whatsapp-media.js <householdId> [YYYY-MM-DD]
 *   node scripts/recover-whatsapp-media.js --phone +447... [YYYY-MM-DD]
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (+ Supabase for the
 * household lookup). Downloads land in /tmp/wa-media-<msgSid>-<n>.<ext>.
 */

require('dotenv').config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const AUTH_HEADER = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

const fs = require('fs');
const path = require('path');

// MIME → extension for the common WhatsApp document/image types.
const EXT = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'text/plain': 'txt',
  'text/calendar': 'ics',
};

async function twilioGet(url) {
  const res = await fetch(url, { headers: { Authorization: AUTH_HEADER } });
  if (!res.ok) throw new Error(`Twilio ${res.status} for ${url}`);
  return res.json();
}

async function resolvePhone(arg, dateArg) {
  if (arg === '--phone') {
    return { phone: process.argv[4], date: process.argv[5] || '2026-06-01' };
  }
  // Treat arg as a household ID; look up linked members' phones.
  const { supabaseAdmin } = require('../src/db/client');
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('name, whatsapp_phone')
    .eq('household_id', arg)
    .eq('whatsapp_linked', true)
    .not('whatsapp_phone', 'is', null);
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`No WhatsApp-linked members in household ${arg}`);
  // If more than one, the caller can re-run with --phone for a specific one.
  console.log('Linked members:', data.map(d => `${d.name} ${d.whatsapp_phone}`).join(', '));
  return { phone: data[0].whatsapp_phone, date: dateArg || '2026-06-01' };
}

(async () => {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    console.error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN in env.');
    process.exit(1);
  }
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/recover-whatsapp-media.js <householdId> [YYYY-MM-DD]');
    console.error('   or: node scripts/recover-whatsapp-media.js --phone +447... [YYYY-MM-DD]');
    process.exit(1);
  }

  const { phone, date } = await resolvePhone(arg, process.argv[3]);
  const from = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone.startsWith('+') ? phone : '+' + phone}`;
  console.log(`\nSearching Twilio for inbound media from ${from} on ${date}...\n`);

  // List messages From this number on the given day. DateSent filters to
  // the UTC day. PageSize 100 is plenty for one user/day.
  const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`
    + `?From=${encodeURIComponent(from)}&DateSent=${date}&PageSize=100`;
  const list = await twilioGet(listUrl);
  const messages = list.messages || [];
  if (messages.length === 0) {
    console.log('No messages found from that number on that date. Try a different date, or --phone with the exact number.');
    process.exit(0);
  }

  let downloaded = 0;
  for (const msg of messages) {
    const numMedia = parseInt(msg.num_media || '0', 10);
    if (numMedia === 0) continue;
    console.log(`Message ${msg.sid} @ ${msg.date_sent} - ${numMedia} media, body: "${(msg.body || '').slice(0, 60)}"`);

    const mediaList = await twilioGet(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${msg.sid}/Media.json`
    );
    for (let i = 0; i < (mediaList.media_list || []).length; i++) {
      const m = mediaList.media_list[i];
      const ext = EXT[m.content_type] || 'bin';
      // The media binary is at the Media resource URI without .json.
      const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages/${msg.sid}/Media/${m.sid}`;
      const res = await fetch(mediaUrl, { headers: { Authorization: AUTH_HEADER } });
      if (!res.ok) { console.warn(`  media ${m.sid}: HTTP ${res.status}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const out = path.join('/tmp', `wa-media-${msg.sid}-${i}.${ext}`);
      fs.writeFileSync(out, buf);
      console.log(`  ↳ saved ${m.content_type} (${buf.length} bytes) -> ${out}`);
      downloaded++;
    }
  }

  console.log(`\nDone. ${downloaded} media file(s) recovered.`);
  process.exit(0);
})().catch((err) => {
  console.error('Recovery failed:', err.message);
  process.exit(1);
});
