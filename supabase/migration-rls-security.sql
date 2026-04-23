-- Enable Row Level Security on tables flagged by Supabase linter
-- All backend access uses service_role key (bypasses RLS), so this is defense-in-depth only.

-- 1. Enable RLS on all three tables
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

-- 2. Admin analytics tables: no policies = deny all non-service-role access
COMMENT ON TABLE public.ai_usage_log IS 'Admin analytics table. RLS enabled with no policies — only accessible via service_role key.';
COMMENT ON TABLE public.whatsapp_message_log IS 'Admin analytics table. RLS enabled with no policies — only accessible via service_role key.';

-- 3. Shopping lists: allow authenticated access (matches existing meals pattern)
CREATE POLICY "Allow all for authenticated" ON public.shopping_lists
  FOR ALL USING (true) WITH CHECK (true);
