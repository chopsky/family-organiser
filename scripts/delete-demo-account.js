#!/usr/bin/env node
/**
 * Delete the Bennett demo household (cascade wipes all seeded data).
 *
 * Usage:
 *   node scripts/delete-demo-account.js
 */

require('dotenv').config();
const { supabaseAdmin: db } = require('../src/db/client');

async function run() {
  const { data: sarah } = await db
    .from('users')
    .select('id, household_id')
    .eq('email', 'sarah.demo@housemait.com')
    .maybeSingle();

  if (!sarah) {
    console.log('No demo account found — nothing to delete.');
    return;
  }

  if (sarah.household_id) {
    const { error } = await db.from('households').delete().eq('id', sarah.household_id);
    if (error) throw new Error(`Failed to delete household: ${error.message}`);
    console.log(`✓ Deleted household ${sarah.household_id} (cascade removes users, tasks, events, etc.)`);
  }

  // Mop up orphans
  const { error: userErr } = await db.from('users').delete().in('email', [
    'sarah.demo@housemait.com',
    'james.demo@housemait.com',
  ]);
  if (userErr) console.warn('User cleanup warning:', userErr.message);

  console.log('✓ Demo account removed');
}

run().catch((err) => {
  console.error('❌ Delete failed:', err.message);
  process.exit(1);
});
