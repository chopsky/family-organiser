const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testConnection() {
  const { error } = await supabase.from('households').select('count').limit(1);
  if (error && error.code !== 'PGRST116') {
    throw new Error(`Database connection failed: ${error.message}`);
  }
}

module.exports = { supabase, testConnection };
