#!/usr/bin/env node
/**
 * Granular wipe of the Bennett demo household.
 *
 * The one-shot `households.delete()` cascade hits Supabase's statement
 * timeout (it scans every child table in a single statement). This deletes
 * each child table individually — small, scoped statements that each get the
 * full timeout budget — then removes the household. Errors per table are
 * tolerated (missing column / no rows) so the wipe is robust to schema drift.
 *
 * Usage: node scripts/wipe-demo-household.js
 */
require('dotenv').config();
const { supabaseAdmin: db } = require('../src/db/client');

const DEMO_EMAILS = ['sarah.demo@housemait.com', 'james.demo@housemait.com'];

// Child tables, ordered leaf-first to avoid FK RESTRICT issues. Deleted by
// household_id; for the handful that are user-scoped we fall back to user_id.
const HOUSEHOLD_TABLES = [
  'event_assignees', 'event_attachments', 'event_reminders',
  'calendar_sync_mappings', 'calendar_feed_tokens', 'calendar_connections',
  'calendar_events',
  'shopping_items', 'shopping_lists',
  'child_school_events', 'child_weekly_schedule',
  'school_term_dates', 'household_schools',
  'meal_plan', 'meal_categories', 'recipes',
  'tasks',
  'document_access_log', 'documents', 'document_folders',
  'household_notes', 'household_preferences', 'household_inbound_senders',
  'external_calendar_feeds', 'invites', 'household_subscriptions',
  'chat_messages', 'chat_conversations',
  'ai_usage_log', 'whatsapp_message_log', 'whatsapp_verification_codes',
  'inbound_email_log', 'sent_emails',
  'notification_preferences', 'device_tokens', 'refresh_tokens',
];

function isMissingColumn(error) {
  const msg = (error?.message || '').toLowerCase();
  return error?.code === '42703' || (msg.includes('column') && msg.includes('does not exist'));
}

async function run() {
  const { data: sarah } = await db
    .from('users')
    .select('id, household_id')
    .eq('email', 'sarah.demo@housemait.com')
    .maybeSingle();

  if (!sarah?.household_id) {
    console.log('No demo household found - nothing to wipe.');
    return;
  }
  const hid = sarah.household_id;
  console.log(`→ Wiping household ${hid} table-by-table…`);

  // Member user IDs (for user-scoped tables that lack household_id).
  const { data: members } = await db.from('users').select('id').eq('household_id', hid);
  const memberIds = (members || []).map((m) => m.id);

  for (const table of HOUSEHOLD_TABLES) {
    let { error } = await db.from(table).delete().eq('household_id', hid);
    if (error && isMissingColumn(error) && memberIds.length) {
      ({ error } = await db.from(table).delete().in('user_id', memberIds));
    }
    if (error && isMissingColumn(error)) {
      console.log(`   · ${table}: skipped (no household_id/user_id)`);
    } else if (error) {
      console.warn(`   · ${table}: ${error.message}`);
    } else {
      console.log(`   ✓ ${table}`);
    }
  }

  // Users, then the household shell.
  const { error: uErr } = await db.from('users').delete().eq('household_id', hid);
  if (uErr) console.warn(`   · users: ${uErr.message}`);
  else console.log('   ✓ users');

  const { error: hErr } = await db.from('households').delete().eq('id', hid);
  if (hErr) throw new Error(`Failed to delete household: ${hErr.message}`);
  console.log('   ✓ households');

  // Mop up any orphaned demo users.
  await db.from('users').delete().in('email', DEMO_EMAILS);
  console.log('✓ Demo household wiped');
}

run().catch((err) => { console.error('❌ Wipe failed:', err.message); process.exit(1); });
