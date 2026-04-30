-- Migration: enable RLS on server-only tables flagged by Supabase Security Advisor
--
-- The Supabase Security Advisor raised 4 CRITICAL findings:
--   1. public.device_tokens has RLS disabled
--   2. public.notification_preferences has RLS disabled
--   3. public.refresh_tokens has RLS disabled
--   4. public.device_tokens.token column exposed via API without RLS
--
-- All three tables are accessed exclusively from the Node API using
-- the Supabase service-role key, which bypasses RLS unconditionally.
-- They were never meant to be reachable from the browser via the
-- anon/authenticated PostgREST path — but with RLS disabled, the
-- public anon key (which is, by design, embedded in the web bundle
-- and therefore readable by anyone) gives full SELECT/INSERT/UPDATE/
-- DELETE access via PostgREST.
--
-- The most urgent of the three is refresh_tokens — anyone with a leak
-- could impersonate users indefinitely until manual rotation.
--
-- Fix: turn on RLS, add NO policies. With RLS on and zero policies,
-- non-service-role queries return zero rows / zero rights. The
-- service-role keeps working because it bypasses RLS — see Supabase
-- docs: "service_role key bypasses Row Level Security".
--
-- Same approach we used for external_calendar_feeds in
-- migration-external-calendar-feeds.sql.

ALTER TABLE public.device_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens            ENABLE ROW LEVEL SECURITY;

-- Verify (each row should show rowsecurity = true)
SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('device_tokens', 'notification_preferences', 'refresh_tokens')
 ORDER BY tablename;
