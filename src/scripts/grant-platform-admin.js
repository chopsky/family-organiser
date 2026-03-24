#!/usr/bin/env node

/**
 * Grant or revoke platform admin status for a user.
 *
 * Usage:
 *   node src/scripts/grant-platform-admin.js grant user@example.com
 *   node src/scripts/grant-platform-admin.js revoke user@example.com
 */

require('dotenv').config();
const { supabase } = require('../db/client');

async function main() {
  const [action, email] = process.argv.slice(2);

  if (!action || !email || !['grant', 'revoke'].includes(action)) {
    console.error('Usage: node src/scripts/grant-platform-admin.js <grant|revoke> <email>');
    process.exit(1);
  }

  const isPlatformAdmin = action === 'grant';

  const { data, error } = await supabase
    .from('users')
    .update({ is_platform_admin: isPlatformAdmin })
    .eq('email', email)
    .select('id, name, email, is_platform_admin')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      console.error(`No user found with email: ${email}`);
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }

  console.log(`${isPlatformAdmin ? 'Granted' : 'Revoked'} platform admin for ${data.name} (${data.email})`);
}

main();
