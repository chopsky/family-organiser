const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or SUPABASE_ANON_KEY environment variables');
}

// Admin client — bypasses RLS. Use ONLY for:
//   - User registration (before a JWT exists)
//   - Admin dashboard queries
//   - Background jobs (reminders, cleanup)
//   - Any operation that intentionally needs cross-household access
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// User client factory — respects RLS. Call this in route handlers,
// passing the user's JWT so Supabase knows which household to scope to.
//
// Usage in a route:
//   const db = getUserClient(req.token);
//   const { data } = await db.from('tasks').select('*');
//   // ↑ automatically filtered to the user's household by RLS
//
function getUserClient(jwtToken) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
      },
    },
  });
}

async function testConnection() {
  const { error } = await supabaseAdmin.from('households').select('count').limit(1);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Database connection failed: ${error.message}`);
  }
}

module.exports = { supabaseAdmin, getUserClient, testConnection };
